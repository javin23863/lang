#!/usr/bin/env python3
"""
translation_server.py — bilingual video room with live captions.

Both people open the same link in a browser. Camera and call audio go
peer-to-peer over WebRTC (this server only relays the signalling); a second,
16kHz mono copy of each microphone comes here over the WebSocket, where it is
transcribed (faster-whisper large-v3-turbo) and translated (CTranslate2
OPUS-MT), then pushed back to the room as captions.

Captions are emitted repeatedly per utterance: a partial every PARTIAL_EVERY_S
while you are still speaking, and a final once you stop. Every caption carries
the speaker's id — each client decides for itself which bubbles are its own.
Handing out a server-side "me" label, as this file used to, showed both people
their own name on every line.

All ASR and MT run on this machine. No paid APIs.
"""

import os
import sys
import json
import secrets
import time
import asyncio
import threading
from dataclasses import dataclass, field

import numpy as np

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt_ct2
import tts_local
from endpointer import Endpointer

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")

# Single source of truth for the port. Deliberately not 8765: another app on
# this machine listens there, and Windows lets a second process bind an
# already-bound port rather than refusing, so both servers sit on it and
# whichever the OS picks answers — the room starts fine and serves someone
# else's 404s.
DEFAULT_PORT = 8791

SAMPLE_RATE = 16000
PARTIAL_EVERY_S = 0.4      # cadence of in-flight captions; ASR takes ~0.25s,
                           # so the worker still drains faster than this fills
MIN_PARTIAL_S = 0.8        # below this, whisper returns confident filler
                           # ("Gracias." for 0.6s of Spanish) rather than nothing
                           # — see the regression check in asr_whisper._demo
END_SILENCE_MS = 500       # trailing quiet that ends an utterance
MAX_UTTERANCE_S = 15.0     # force a final; whisper degrades on long audio
IDLE_DROP_S = 3.0          # discard a buffer holding nothing but silence

# The room is reachable over a public tunnel, so a client is not trusted. The
# browser sends 100ms frames (3200 bytes); anything an order of magnitude past
# that is not this app. Enforced twice on purpose: ws_max_size stops the
# framework from ever buffering a huge message, and the check in the handler
# covers anything that gets through a different server config.
MAX_FRAME_BYTES = 32000    # 1 second of int16 @ 16kHz
WS_MAX_SIZE = 65536

# Anyone holding the link can join, same as a video-call link. That is the
# intended trust model, but it should not also mean unbounded: each participant
# adds a continuous ASR stream competing for one GPU, so a handful of joiners
# would starve the conversation the room exists for.
MAX_PARTICIPANTS = 4
PRE_JOIN_TIMEOUT_S = 10    # a socket that opens and says nothing is not a guest
MAX_TTS_CHARS = 300        # a final caption, not an arbitrary audiobook request
MAX_TTS_BODY_BYTES = 2048  # reject before buffering a public request body
VOICE_STYLES = ("female", "male")
ROOM_TTL_S = 24 * 60 * 60  # an invite survives a restart-free day, then expires
MAX_ROOMS = 64             # ponytail: one-host ceiling; add persistent storage when needed

app = FastAPI(title="Live Translator Room")
_tts_job: asyncio.Task | None = None  # one CPU job; callers fail fast, never pile up


# ── Participants ──────────────────────────────────────────────────────

@dataclass
class Participant:
    id: int
    ws: WebSocket
    room: str = ""
    lang: str = "en"
    name: str = ""
    voice_style: str = "female"  # selected preference, never inferred
    ep: Endpointer = field(default_factory=Endpointer)
    seq: int = 0                  # utterance counter
    onset: float = 0.0            # wall clock when the current utterance began
    last_partial: float = 0.0
    tts_pending: bool = False
    tts_token: str = field(default_factory=lambda: secrets.token_urlsafe(24))

    def public(self):
        return {"id": self.id, "lang": self.lang, "name": self.name,
                "voice_style": self.voice_style}


participants: dict[int, Participant] = {}
rooms: dict[str, float] = {}  # room id -> expiry; deliberately memory-only
# Host controls are intentionally separate from participant invitations. They
# stay only in this local process; the permanent Worker signs an equivalent
# room-bound bearer with its existing HMAC key.
host_controls: dict[str, str] = {}  # control bearer -> room id
closed_rooms: dict[str, float] = {}  # room id -> original expiry tombstone
_next_id = 1
_id_lock = threading.Lock()


def _new_id() -> int:
    global _next_id
    with _id_lock:
        pid, _next_id = _next_id, _next_id + 1
        return pid


def _prune_rooms(now: float | None = None):
    now = now or time.time()
    active = {p.room for p in participants.values()}
    for room_id, expiry in list(rooms.items()):
        if expiry <= now and room_id not in active:
            rooms.pop(room_id, None)
            closed_rooms.pop(room_id, None)
            for control, controlled_room in list(host_controls.items()):
                if controlled_room == room_id:
                    host_controls.pop(control, None)


def create_room() -> str:
    """Create a 144-bit invitation id. Possession of the URL is room access."""
    _prune_rooms()
    if len(rooms) >= MAX_ROOMS:
        raise RuntimeError("room capacity reached")
    while True:
        room_id = secrets.token_urlsafe(18)
        if room_id not in rooms:
            rooms[room_id] = time.time() + ROOM_TTL_S
            return room_id


def room_is_live(room_id: str) -> bool:
    expiry = rooms.get(room_id)
    if room_id in closed_rooms or expiry is None or expiry <= time.time():
        _prune_rooms()
        return False
    return True


def room_is_closed(room_id: str) -> bool:
    expiry = closed_rooms.get(room_id)
    if expiry is None:
        return False
    if expiry <= time.time():
        _prune_rooms()
        return False
    return True


def create_host_control(room_id: str) -> str:
    """Mint a local-only host bearer that never appears in the room URL."""
    while True:
        control = secrets.token_urlsafe(32)
        if control not in host_controls:
            host_controls[control] = room_id
            return control


def controlled_room(token: str) -> str | None:
    """Return an unexpired live or tombstoned room for its exact host bearer."""
    if not token or " " in token:
        return None
    for control, room_id in host_controls.items():
        if secrets.compare_digest(control, token):
            expiry = rooms.get(room_id)
            return room_id if expiry is not None and expiry > time.time() else None
    return None


def request_is_same_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    host = request.headers.get("host")
    forwarded = request.headers.get("x-forwarded-proto", request.url.scheme)
    scheme = forwarded.split(",", 1)[0].strip().lower()
    if not origin or not host or scheme not in ("http", "https"):
        return False
    return origin == f"{scheme}://{host}"


def control_request_is_same_origin(request: Request) -> bool:
    if request_is_same_origin(request):
        return True
    # Same-origin fetch GETs do not consistently carry Origin. Fetch Metadata
    # is browser-set and lets the installed dashboard refresh safely without
    # accepting a cross-site control request.
    return (request.method == "GET"
            and request.headers.get("sec-fetch-site") == "same-origin"
            and request.headers.get("sec-fetch-mode") in ("cors", "same-origin"))


def control_room_from_request(request: Request) -> str | None:
    if not control_request_is_same_origin(request):
        return None
    authorization = request.headers.get("authorization", "")
    token = authorization.removeprefix("Bearer ") if authorization.startswith("Bearer ") else ""
    return controlled_room(token)


def room_participants(room_id: str) -> list[Participant]:
    return [p for p in participants.values() if p.room == room_id]


def target_langs(speaker: Participant) -> list[str]:
    """Languages the *other* people in the room read."""
    return sorted({p.lang for p in participants.values()
                   if p.room == speaker.room and p.id != speaker.id
                   and p.lang != speaker.lang})


# ── Job queue: finals always run, partials are latest-wins ────────────

@dataclass
class Job:
    pid: int
    audio: np.ndarray
    lang: str
    targets: list[str]
    seq: int
    final: bool
    onset: float


class JobQueue:
    """One GPU worth of work, ordered so latency cannot compound.

    Partials are superseded: if a speaker's newer partial arrives while an
    older one is still queued, the older one is dropped — decoding audio the
    speaker has already moved past only pushes every later caption further
    behind. Finals are never dropped; they are what the reader keeps.
    """

    def __init__(self):
        self._cv = threading.Condition()
        self._finals: list[Job] = []
        self._partials: dict[int, Job] = {}
        self.dropped_partials = 0

    def put(self, job: Job):
        with self._cv:
            if job.final:
                self._finals.append(job)
                # A final supersedes any partial of any utterance from that
                # speaker: the text is about to be replaced anyway.
                if self._partials.pop(job.pid, None) is not None:
                    self.dropped_partials += 1
            else:
                if self._partials.pop(job.pid, None) is not None:
                    self.dropped_partials += 1
                self._partials[job.pid] = job
            self._cv.notify()

    def get(self, timeout=None) -> Job | None:
        with self._cv:
            if not self._finals and not self._partials:
                self._cv.wait(timeout)
            if self._finals:
                return self._finals.pop(0)
            if self._partials:
                return self._partials.pop(next(iter(self._partials)))
            return None

    def drop_speaker(self, pid: int):
        with self._cv:
            self._partials.pop(pid, None)
            self._finals = [j for j in self._finals if j.pid != pid]

    def __len__(self):
        with self._cv:
            return len(self._finals) + len(self._partials)


jobs = JobQueue()


# ── Audio ingest + endpointing (runs on the event loop) ───────────────

def ingest(p: Participant, pcm: np.ndarray):
    """Feed one ~100ms frame; enqueue partial/final work when it is due."""
    speech, silent_ms = p.ep.feed(pcm)
    now = time.time()

    if not speech:
        # Nothing but silence so far — keep the buffer from growing forever.
        if p.ep.duration_ms > IDLE_DROP_S * 1000:
            p.ep.take()
        return

    if p.onset == 0.0:
        p.onset = now
        p.seq += 1
        p.last_partial = 0.0

    # Speech seconds, not buffered seconds. The buffer also holds the silence
    # that preceded the first word, and gating on that let a 0.5s utterance
    # through as if it were 0.9s — whisper answered it with invented filler.
    speech_s = p.ep.speech_ms / 1000
    ended = silent_ms >= END_SILENCE_MS
    overlong = speech_s >= MAX_UTTERANCE_S

    if ended or overlong:
        audio = p.ep.take()
        jobs.put(Job(p.id, audio, p.lang, target_langs(p), p.seq, True, p.onset))
        p.onset = 0.0
        return

    if speech_s >= MIN_PARTIAL_S and now - p.last_partial >= PARTIAL_EVERY_S:
        p.last_partial = now
        jobs.put(Job(p.id, p.ep.pending(), p.lang, target_langs(p),
                     p.seq, False, p.onset))


# ── GPU worker ────────────────────────────────────────────────────────

_asr = None
_asr_ready = threading.Event()


def _load_models():
    global _asr
    from asr_whisper import WhisperASR
    _asr = WhisperASR()
    mt_ct2.preload()
    _asr_ready.set()
    print("[server] models ready")


def _worker():
    _asr_ready.wait()
    while True:
        job = jobs.get(timeout=0.5)
        if job is None:
            continue
        try:
            _handle(job)
        except Exception as e:  # noqa: BLE001 - one bad utterance must not end the room
            print(f"[worker] {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()


def _handle(job: Job):
    speaker = participants.get(job.pid)
    if speaker is None:
        return
    if not job.final and speaker.seq != job.seq:
        # The utterance ended while this partial waited its turn. Decoding it
        # would repaint a bubble the final has already replaced.
        return

    text = _asr.transcribe(job.audio, job.lang, partial=not job.final)

    translations = {}
    if text:
        for tgt in job.targets:
            out, reason = mt_ct2.translate(
                text, f"{job.lang}-{tgt}", stream_id=str(job.pid), final=job.final)
            if out:
                translations[tgt] = out
            elif job.final:
                # A suppressed final (loop, duplicate) must not leave the
                # original standing next to a stale translation.
                print(f"[mt] suppressed {job.lang}-{tgt}: {reason}")

    broadcast_from_thread(caption_message(job, text, translations), speaker.room)


def caption_message(job: Job, text: str, translations: dict) -> dict:
    """The wire format. Note there is no "me"/"remote" field: the speaker's id
    is sent and each client compares it to its own, because a label baked in
    here is wrong for everyone except the person it was computed for."""
    return {
        "type": "caption",
        "speaker": job.pid,
        "speaker_lang": job.lang,
        "seq": job.seq,
        "final": job.final,
        "original": text,
        "translations": translations,
        "t_ms": round((time.time() - job.onset) * 1000),
    }


# ── Broadcast ─────────────────────────────────────────────────────────

_server_loop: asyncio.AbstractEventLoop | None = None


async def broadcast(message: dict, room_id: str, exclude: int | None = None):
    msg = json.dumps(message)
    for p in list(participants.values()):
        if p.room != room_id or p.id == exclude:
            continue
        try:
            await p.ws.send_text(msg)
        except Exception:
            participants.pop(p.id, None)


def broadcast_from_thread(message: dict, room_id: str):
    if _server_loop is not None:
        asyncio.run_coroutine_threadsafe(broadcast(message, room_id), _server_loop)
    else:
        print("[server] WARNING: no event loop for broadcast")


async def send_to(pid: int, message: dict, room_id: str):
    p = participants.get(pid)
    if p is None or p.room != room_id:
        return
    try:
        await p.ws.send_text(json.dumps(message))
    except Exception:
        participants.pop(pid, None)


# ── Routes ────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
async def index():
    with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
        return HTMLResponse(f.read(), headers={
            "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        })


@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse(os.path.join(STATIC, "manifest.webmanifest"),
                        media_type="application/manifest+json")


@app.get("/icon.svg")
async def app_icon():
    return FileResponse(os.path.join(STATIC, "icon.svg"), media_type="image/svg+xml")


@app.get("/sw.js")
async def service_worker():
    return FileResponse(os.path.join(STATIC, "sw.js"),
                        media_type="text/javascript", headers={
                            "Cache-Control": "no-store",
                            "Service-Worker-Allowed": "/",
                        })


@app.post("/rooms")
async def open_room(request: Request):
    if not request_is_same_origin(request):
        return HTMLResponse("Forbidden", status_code=403)
    try:
        room_id = create_room()
    except RuntimeError:
        return HTMLResponse("No room is available right now.", status_code=503)
    return RedirectResponse(f"/room/{room_id}", status_code=303)


@app.post("/api/rooms")
async def new_room(request: Request):
    if not request_is_same_origin(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        room_id = create_room()
    except RuntimeError:
        return JSONResponse({"error": "room capacity reached"}, status_code=503)
    return JSONResponse({
        "path": f"/room/{room_id}",
        "host_control": create_host_control(room_id),
        "expires_at": int(rooms[room_id]),
    }, status_code=201, headers={
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    })


@app.get("/room/{room_id}")
async def room_page(room_id: str):
    if not room_is_live(room_id):
        return HTMLResponse("This private room does not exist or has expired.",
                            status_code=404)
    with open(os.path.join(STATIC, "room.html"), encoding="utf-8") as f:
        return HTMLResponse(f.read(), headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
        })


@app.get("/api/room")
async def room_preflight(request: Request):
    authorization = request.headers.get("authorization", "")
    room_id = authorization.removeprefix("Bearer ") if authorization.startswith("Bearer ") else ""
    if room_is_closed(room_id):
        return Response(status_code=410, headers={"Cache-Control": "no-store",
                                                   "Referrer-Policy": "no-referrer"})
    if not room_id or " " in room_id or not room_is_live(room_id):
        return Response(status_code=401, headers={"Cache-Control": "no-store",
                                                   "Referrer-Policy": "no-referrer"})
    return Response(status_code=204, headers={"Cache-Control": "no-store",
                                               "Referrer-Policy": "no-referrer"})


def host_room_state(room_id: str) -> dict:
    count = 0 if room_is_closed(room_id) else len(room_participants(room_id))
    return {
        "state": "closed" if room_is_closed(room_id) else ("open" if count else "ready"),
        "participant_count": count,
        "participant_limit": MAX_PARTICIPANTS,
    }


async def revoke_room(room_id: str) -> None:
    """Terminally disconnect a room without deleting its expiry tombstone."""
    if room_is_closed(room_id):
        return
    expiry = rooms.get(room_id)
    if expiry is None or expiry <= time.time():
        return
    closed_rooms[room_id] = expiry
    closing = room_participants(room_id)
    # Remove first: close callbacks cannot fan stale presence to a peer after
    # the terminal message, and queued compute is cancelled before the socket.
    for participant in closing:
        participants.pop(participant.id, None)
        jobs.drop_speaker(participant.id)
    for participant in closing:
        try:
            await participant.ws.send_text(json.dumps({"type": "room_closed"}))
            await participant.ws.close(code=4001, reason="room closed")
        except Exception:
            pass


@app.get("/api/room-control")
async def room_control_status(request: Request):
    room_id = control_room_from_request(request)
    if room_id is None:
        return JSONResponse({"error": "forbidden"}, status_code=403,
                            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    return JSONResponse(host_room_state(room_id), headers={
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    })


@app.post("/api/room-control/close")
async def close_room(request: Request):
    room_id = control_room_from_request(request)
    if room_id is None:
        return JSONResponse({"error": "forbidden"}, status_code=403,
                            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    await revoke_room(room_id)
    return JSONResponse(host_room_state(room_id), headers={
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    })


@app.get("/test")
async def test_page():
    """Mic diagnostic — earned its keep debugging getUserMedia on the phone."""
    with open(os.path.join(STATIC, "mictest.html"), encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/health")
async def health():
    return {
        "status": "ok",
        # Health is public for the launcher; never enumerate private callers.
        "participants": len(participants),
        "models_ready": _asr_ready.is_set(),
        "asr_device": getattr(_asr, "device", None),
        "queue": len(jobs),
        "dropped_partials": jobs.dropped_partials,
        "tts": tts_local.status(),
    }


@app.post("/tts")
async def tts_audio(request: Request):
    global _tts_job
    token = request.headers.get("x-tts-token")
    p = next((guest for guest in participants.values()
              if secrets.compare_digest(guest.tts_token, token or "")), None)
    if p is None:
        return JSONResponse({"error": "not a joined room participant"}, status_code=403)

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_TTS_BODY_BYTES:
                return JSONResponse({"error": "request body is too large"}, status_code=413)
        except ValueError:
            return JSONResponse({"error": "invalid content length"}, status_code=400)

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_TTS_BODY_BYTES:
            return JSONResponse({"error": "request body is too large"}, status_code=413)
        body.extend(chunk)
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse({"error": "invalid JSON"}, status_code=400)
    if not isinstance(data, dict):
        return JSONResponse({"error": "invalid spoken translation request"}, status_code=422)
    text, lang = data.get("text"), data.get("lang")
    voice_style = data.get("voice_style", "female")
    if not (isinstance(text, str) and 0 < len(text) <= MAX_TTS_CHARS
            and lang == p.lang and lang in mt_ct2.ROOM_LANGS
            and voice_style in VOICE_STYLES):
        return JSONResponse({"error": "invalid spoken translation request"}, status_code=422)
    if p.tts_pending:
        return JSONResponse({"error": "spoken translation is already pending"}, status_code=429)
    if _tts_job is not None and not _tts_job.done():
        return JSONResponse({"error": "spoken translation is busy"}, status_code=429)

    p.tts_pending = True
    async def generate():
        try:
            return await asyncio.to_thread(tts_local.synthesize, text, lang)
        finally:
            p.tts_pending = False

    _tts_job = asyncio.create_task(generate())
    try:
        # A running thread cannot be cancelled safely. The HTTP request gets a
        # bounded answer, but shield keeps ownership of the one global job until
        # it actually finishes; later callers get 429 instead of piling up.
        audio = await asyncio.wait_for(asyncio.shield(_tts_job), timeout=60)
    except asyncio.TimeoutError:
        print(f"[tts] {lang} timed out; the bounded worker is still finishing")
        return JSONResponse({"error": "spoken translation timed out"}, status_code=503)
    except Exception as exc:
        print(f"[tts] {lang} failed: {type(exc).__name__}: {exc}")
        return JSONResponse({"error": "spoken translation is unavailable"}, status_code=503)
    return Response(audio, media_type="audio/wav",
                    headers={"Cache-Control": "no-store"})


@app.websocket("/ws/{room_id}")
async def ws_endpoint(ws: WebSocket, room_id: str):
    await ws.accept()
    if not room_is_live(room_id):
        await ws.close(code=4001 if room_is_closed(room_id) else 1008,
                       reason="room closed" if room_is_closed(room_id) else "room unavailable")
        return
    p = Participant(id=_new_id(), ws=ws, room=room_id)
    # A socket occupies a slot only once it has joined. Counting connections
    # instead let four sockets that never send `join` — trivial to open against
    # a public link — hold the room shut against everyone real. Nothing before
    # the join is registered anywhere, and anything that stalls before joining
    # is dropped on the deadline below.
    joined = False
    # An absolute deadline, not a per-receive timeout. Timing out each receive
    # restarts the clock on every message, so a client could hold an unjoined
    # socket open forever by sending ignored traffic faster than the timeout.
    # The budget is for joining, not for staying quiet between messages.
    join_deadline = time.monotonic() + PRE_JOIN_TIMEOUT_S

    try:
        while True:
            if joined:
                msg = await ws.receive()
            else:
                remaining = join_deadline - time.monotonic()
                if remaining <= 0:
                    raise asyncio.TimeoutError
                msg = await asyncio.wait_for(ws.receive(), remaining)
            if msg["type"] == "websocket.disconnect":
                break
            if not joined:
                # Only a join is meaningful before joining; audio from an
                # unjoined socket has no language and no one to translate for.
                if msg.get("text") is None:
                    continue
                data = json.loads(msg["text"])
                if data.get("type") != "join":
                    continue
                # Check and insert with no await between them: the event loop is
                # single-threaded, so this pair is atomic and the limit cannot be
                # raced past by simultaneous joiners.
                in_room = room_participants(room_id)
                if (len(participants) >= MAX_PARTICIPANTS
                        or len(in_room) >= MAX_PARTICIPANTS):
                    print(f"[server] refusing join: room has {len(in_room)}; "
                          f"host has {len(participants)}")
                    await ws.send_text(json.dumps(
                        {"type": "room_full", "limit": MAX_PARTICIPANTS}))
                    await ws.close(code=1013)  # try again later
                    return
                participants[p.id] = p
                joined = True
                print(f"[server] participant {p.id} joined "
                      f"({len(participants)}/{MAX_PARTICIPANTS})")
                await _on_control(p, data)
                continue

            if msg.get("bytes") is not None:
                raw = msg["bytes"]
                # Check before converting: the float32 copy is twice the size,
                # and ingest() would append it straight onto the endpointer
                # buffer, so an oversized frame is cheapest to refuse here.
                if len(raw) > MAX_FRAME_BYTES:
                    print(f"[server] participant {p.id} sent a {len(raw)}B audio "
                          f"frame (max {MAX_FRAME_BYTES}); closing")
                    await ws.close(code=1009)  # message too big
                    break
                # int16 mono @16kHz from the browser's AudioWorklet
                pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                ingest(p, pcm)
            elif msg.get("text") is not None:
                await _on_control(p, json.loads(msg["text"]))
    except asyncio.TimeoutError:
        print(f"[server] socket {p.id} never joined in {PRE_JOIN_TIMEOUT_S}s; closing")
        try:
            await ws.close(code=1008)   # policy violation
        except Exception:
            pass
    except WebSocketDisconnect:
        pass
    except (RuntimeError, ValueError, KeyError) as e:
        print(f"[server] participant {p.id} error: {type(e).__name__}: {e}")
    finally:
        if joined:
            participants.pop(p.id, None)
            jobs.drop_speaker(p.id)
            await broadcast({"type": "peer_leave", "id": p.id}, p.room)
            print(f"[server] participant {p.id} disconnected")


async def _on_control(p: Participant, data: dict):
    kind = data.get("type")

    if kind == "join":
        requested = data.get("lang")
        p.lang = requested if requested in mt_ct2.ROOM_LANGS else "en"
        requested_style = data.get("voice_style")
        p.voice_style = requested_style if requested_style in VOICE_STYLES else "female"
        name = data.get("name")
        p.name = name[:40] if isinstance(name, str) and name.strip() else f"Speaker {p.id}"
        await send_to(p.id, {
            "type": "welcome",
            "id": p.id,
            "tts_token": p.tts_token,
            "tts_provider": "local",
            "langs": list(mt_ct2.ROOM_LANGS),
            "peers": [q.public() for q in room_participants(p.room) if q.id != p.id],
        }, p.room)
        await broadcast({"type": "peer_join", **p.public()}, p.room, exclude=p.id)

    elif kind == "set_lang":
        requested = data.get("lang")
        if requested in mt_ct2.ROOM_LANGS:
            p.lang = requested
        await broadcast({"type": "peer_update", **p.public()}, p.room)

    elif kind == "set_voice_style":
        requested = data.get("voice_style")
        if requested in VOICE_STYLES:
            p.voice_style = requested
        await broadcast({"type": "peer_update", **p.public()}, p.room)

    elif kind == "signal":
        # WebRTC offer/answer/ICE, relayed verbatim. The server neither parses
        # nor stores SDP — video and call audio never touch this process.
        to = data.get("to")
        payload = data.get("data") or {}
        # "Video won't connect" is the failure this app will be asked about most,
        # and from the outside it is indistinguishable from a NAT problem. One
        # line per relayed message says whether ICE candidates flowed at all.
        kindname = ((payload.get("description") or {}).get("type")
                    if payload.get("description") else
                    "ice" if payload.get("candidate") else "?")
        target = participants.get(to)
        same_room = target is not None and target.room == p.room
        print(f"[signal] {p.id} -> {to}: {kindname}"
              + ("" if same_room else "  (NO SUCH ROOM PARTICIPANT)"))
        if same_room:
            await send_to(to, {"type": "signal", "from": p.id, "data": payload}, p.room)

    elif kind == "speech_end":
        # Explicit flush (used by the offline probe); normal calls rely on VAD.
        if p.ep.speech_seen:
            audio = p.ep.take()
            jobs.put(Job(p.id, audio, p.lang, target_langs(p), p.seq, True, p.onset))
            p.onset = 0.0
            p.last_partial = 0.0


# ── Startup ───────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global _server_loop
    _server_loop = asyncio.get_running_loop()
    threading.Thread(target=_load_models, daemon=True).start()
    threading.Thread(target=_worker, daemon=True).start()
    threading.Thread(target=tts_local.preload, daemon=True).start()
    host = getattr(app.state, "listen_host", "0.0.0.0")
    port = getattr(app.state, "listen_port", DEFAULT_PORT)
    print(startup_message(host, port))


def startup_message(host: str, port: int) -> str:
    return f"[server] listening on http://{host}:{port} (models loading in background)"


def run_server(host="0.0.0.0", port=DEFAULT_PORT):
    app.state.listen_host = host
    app.state.listen_port = port
    uvicorn.run(app, host=host, port=port, log_level="warning",
                ws_max_size=WS_MAX_SIZE)


if __name__ == "__main__":
    run_server()

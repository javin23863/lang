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
import time
import asyncio
import threading
from dataclasses import dataclass, field

import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt_ct2
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

app = FastAPI(title="Live Translator Room")


# ── Participants ──────────────────────────────────────────────────────

@dataclass
class Participant:
    id: int
    ws: WebSocket
    lang: str = "en"
    name: str = ""
    ep: Endpointer = field(default_factory=Endpointer)
    seq: int = 0                  # utterance counter
    onset: float = 0.0            # wall clock when the current utterance began
    last_partial: float = 0.0

    def public(self):
        return {"id": self.id, "lang": self.lang, "name": self.name}


participants: dict[int, Participant] = {}
_next_id = 1
_id_lock = threading.Lock()


def _new_id() -> int:
    global _next_id
    with _id_lock:
        pid, _next_id = _next_id, _next_id + 1
        return pid


def target_langs(speaker: Participant) -> list[str]:
    """Languages the *other* people in the room read."""
    return sorted({p.lang for p in participants.values()
                   if p.id != speaker.id and p.lang != speaker.lang})


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

    broadcast_from_thread(caption_message(job, text, translations))


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


async def broadcast(message: dict, exclude: int | None = None):
    msg = json.dumps(message)
    for p in list(participants.values()):
        if p.id == exclude:
            continue
        try:
            await p.ws.send_text(msg)
        except Exception:
            participants.pop(p.id, None)


def broadcast_from_thread(message: dict):
    if _server_loop is not None:
        asyncio.run_coroutine_threadsafe(broadcast(message), _server_loop)
    else:
        print("[server] WARNING: no event loop for broadcast")


async def send_to(pid: int, message: dict):
    p = participants.get(pid)
    if p is None:
        return
    try:
        await p.ws.send_text(json.dumps(message))
    except Exception:
        participants.pop(pid, None)


# ── Routes ────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
async def index():
    with open(os.path.join(STATIC, "room.html"), encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/test")
async def test_page():
    """Mic diagnostic — earned its keep debugging getUserMedia on the phone."""
    with open(os.path.join(STATIC, "mictest.html"), encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "participants": [p.public() for p in participants.values()],
        "models_ready": _asr_ready.is_set(),
        "asr_device": getattr(_asr, "device", None),
        "queue": len(jobs),
        "dropped_partials": jobs.dropped_partials,
    }


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    p = Participant(id=_new_id(), ws=ws)
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
                if len(participants) >= MAX_PARTICIPANTS:
                    print(f"[server] refusing join: room has {len(participants)}")
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
            await broadcast({"type": "peer_leave", "id": p.id})
            print(f"[server] participant {p.id} disconnected")


async def _on_control(p: Participant, data: dict):
    kind = data.get("type")

    if kind == "join":
        p.lang = data.get("lang", "en")
        p.name = data.get("name", f"Speaker {p.id}")
        await send_to(p.id, {
            "type": "welcome",
            "id": p.id,
            "langs": list(mt_ct2.ROOM_LANGS),
            "peers": [q.public() for q in participants.values() if q.id != p.id],
        })
        await broadcast({"type": "peer_join", **p.public()}, exclude=p.id)

    elif kind == "set_lang":
        p.lang = data.get("lang", p.lang)
        await broadcast({"type": "peer_update", **p.public()})

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
        print(f"[signal] {p.id} -> {to}: {kindname}"
              + ("" if to in participants else "  (NO SUCH PARTICIPANT)"))
        await send_to(to, {"type": "signal", "from": p.id, "data": payload})

    elif kind == "speech_end":
        # Explicit flush (used by the offline probe); normal calls rely on VAD.
        if p.ep.speech_seen:
            audio = p.ep.take()
            jobs.put(Job(p.id, audio, p.lang, target_langs(p), p.seq, True, p.onset))
            p.onset = 0.0


# ── Startup ───────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global _server_loop
    _server_loop = asyncio.get_running_loop()
    threading.Thread(target=_load_models, daemon=True).start()
    threading.Thread(target=_worker, daemon=True).start()
    print(f"[server] listening on http://0.0.0.0:{DEFAULT_PORT} (models loading in background)")


def run_server(host="0.0.0.0", port=DEFAULT_PORT):
    uvicorn.run(app, host=host, port=port, log_level="warning",
                ws_max_size=WS_MAX_SIZE)


if __name__ == "__main__":
    run_server()

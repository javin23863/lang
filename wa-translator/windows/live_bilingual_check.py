#!/usr/bin/env python3
"""Real public bilingual acceptance through two ordinary Chrome clients.

This is intentionally separate from ``browser_check.py``.  It does not inject
captions, replace fetch, or supply a silent response.  Six revision-pinned
Kokoro phrases enter Chrome as fake *microphone hardware*, traverse the page's
real AudioWorkletNode and public Worker/Modal path, and the real translated WAV
responses are observed through DevTools without changing them.

The room bearer is never printed.  Only fixed fixture text and bounded metadata
appear in the receipt.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import time
import unicodedata
import urllib.parse
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import websockets


PUBLIC_BASE = os.environ.get(
    "ROOM_BASE",
    "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev",
).rstrip("/")
CHROME = os.environ.get(
    "CHROME_EXE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
CAPTURE_RATE = 48_000
ASR_RATE = 16_000
FRAME_SAMPLES = 1_600
BACKGROUND_SECONDS = 35
MIN_CONVERSATION_SECONDS = 95
PROBE_USER_AGENT = "spoken-translation-live-acceptance/1.0"


@dataclass(frozen=True)
class SemanticTurn:
    at_s: int
    lang: str
    text: str
    original_concepts: tuple[tuple[str, ...], ...]
    translation_concepts: tuple[tuple[str, ...], ...]


SEMANTIC_TURNS = (
    SemanticTurn(15, "en", "Hello Maria, how are you today?",
                 (("hello",), ("maria",), ("today",)),
                 (("hola",), ("maria",), ("hoy",))),
    SemanticTurn(38, "es", "Hola David, estoy muy bien, gracias.",
                 (("hola",), ("david",), ("gracias",)),
                 (("hello", "hi"), ("david",), ("thank",))),
    SemanticTurn(61, "en", "Where is the train station in Madrid?",
                 (("train",), ("station",), ("madrid",)),
                 (("tren",), ("estacion",), ("madrid",))),
    SemanticTurn(84, "es", "La estación de tren está junto al hotel.",
                 (("estacion",), ("tren",), ("hotel",)),
                 (("station",), ("train",), ("hotel",))),
    SemanticTurn(107, "en", "I need help with my reservation for tomorrow.",
                 (("help",), ("reservation",), ("tomorrow",)),
                 (("ayuda",), ("reserva",), ("manana",))),
    SemanticTurn(130, "es", "Su reserva está confirmada para mañana.",
                 (("reserva",), ("confirmada", "confirmado"), ("manana",)),
                 (("reservation",), ("confirm",), ("tomorrow",))),
)


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.lower())
    return "".join(character if character.isalnum() else " "
                   for character in decomposed
                   if not unicodedata.combining(character))


def _has_concepts(value: str, concepts: tuple[tuple[str, ...], ...]) -> bool:
    normalized = _normalize(value)
    return all(any(_normalize(choice) in normalized for choice in alternatives)
               for alternatives in concepts)


def _room() -> tuple[str, str]:
    request = urllib.request.Request(
        f"{PUBLIC_BASE}/api/rooms", method="POST", data=b"",
        headers={"Origin": PUBLIC_BASE, "User-Agent": PROBE_USER_AGENT})
    with urllib.request.urlopen(request, timeout=15) as response:
        path = json.load(response)["path"]
    token = path.rsplit("/", 1)[-1]
    return f"{PUBLIC_BASE}{path}", token


def _wav_metadata(data: bytes) -> dict[str, Any]:
    assert data.startswith(b"RIFF"), (
        f"response is not a RIFF WAV (bytes={len(data)}, prefix={data[:8].hex()})")
    with wave.open(io.BytesIO(data), "rb") as source:
        assert source.getnchannels() == 1
        assert source.getsampwidth() == 2
        frames = source.getnframes()
        rate = source.getframerate()
        pcm = np.frombuffer(source.readframes(frames), dtype="<i2")
    rms = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) if pcm.size else 0.0
    assert frames > rate // 4, "translated voice is too short to audit"
    assert rms > 50, "translated voice WAV is silent"
    return {
        "bytes": len(data), "sample_rate": rate, "frames": frames,
        "duration_s": round(frames / rate, 3), "rms": round(rms, 1),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def _resample_wav(data: bytes, target_rate: int) -> np.ndarray:
    with wave.open(io.BytesIO(data), "rb") as source:
        assert source.getnchannels() == 1 and source.getsampwidth() == 2
        source_rate = source.getframerate()
        pcm = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2")
    if source_rate == target_rate:
        return pcm.copy()
    count = max(1, round(len(pcm) * target_rate / source_rate))
    source_positions = np.arange(len(pcm), dtype=np.float64)
    target_positions = np.arange(count, dtype=np.float64) * source_rate / target_rate
    return np.clip(np.interp(target_positions, source_positions, pcm),
                   -32768, 32767).astype("<i2")


async def _joined_socket(token: str, lang: str):
    url = PUBLIC_BASE.replace("https://", "wss://").replace("http://", "ws://")
    socket = await websockets.connect(
        f"{url}/ws/{urllib.parse.quote(token)}", origin=PUBLIC_BASE, max_size=None)
    await socket.send(json.dumps({
        "type": "join", "lang": lang, "name": "Acceptance fixture",
        "voice_style": "female",
    }))
    while True:
        message = json.loads(await socket.recv())
        if message.get("type") == "welcome":
            return socket, message["id"]


def _tts_request(token: str, participant_id: str, turn: SemanticTurn) -> bytes:
    payload = json.dumps({
        "text": turn.text, "lang": turn.lang, "voice_style": "female",
    }).encode()
    request = urllib.request.Request(
        f"{PUBLIC_BASE}/tts", method="POST", data=payload,
        headers={
            "Origin": PUBLIC_BASE,
            "User-Agent": PROBE_USER_AGENT,
            "Authorization": f"Bearer {token}",
            "X-Participant-ID": participant_id,
            "Content-Type": "application/json",
        })
    with urllib.request.urlopen(request, timeout=90) as response:
        assert response.headers.get_content_type() == "audio/wav"
        return response.read()


async def _generate_microphone_timelines(directory: Path) -> dict[str, Path]:
    _room_url, token = await asyncio.to_thread(_room)
    socket, participant_id = await _joined_socket(token, "en")

    async def heartbeats() -> None:
        while True:
            await asyncio.sleep(8)
            await socket.send(json.dumps({"type": "heartbeat"}))

    heartbeat = asyncio.create_task(heartbeats())
    clips: dict[int, np.ndarray] = {}
    try:
        for index, turn in enumerate(SEMANTIC_TURNS, 1):
            data = await asyncio.to_thread(_tts_request, token, participant_id, turn)
            receipt = _wav_metadata(data)
            clips[index] = _resample_wav(data, CAPTURE_RATE)
            print(json.dumps({
                "event": "fixture_tts", "turn": index, "lang": turn.lang,
                **{key: receipt[key] for key in
                   ("sample_rate", "frames", "duration_s", "rms", "sha256")},
            }, ensure_ascii=False), flush=True)
    finally:
        heartbeat.cancel()
        await socket.close(1000, "fixture complete")

    paths: dict[str, Path] = {}
    # Keep silence beyond the lifecycle gate. Chrome may loop a fake capture at
    # EOF; a loop here would create a seventh real utterance during resume and
    # make the lifecycle receipt ambiguous.
    total_seconds = SEMANTIC_TURNS[-1].at_s + BACKGROUND_SECONDS + 30
    for lang in ("en", "es"):
        timeline = np.zeros(total_seconds * CAPTURE_RATE, dtype="<i2")
        for index, turn in enumerate(SEMANTIC_TURNS, 1):
            if turn.lang != lang:
                continue
            clip = clips[index]
            start = turn.at_s * CAPTURE_RATE
            end = min(len(timeline), start + len(clip))
            timeline[start:end] = clip[:end - start]
        path = directory / f"{lang}-microphone.wav"
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(CAPTURE_RATE)
            output.writeframes(timeline.tobytes())
        paths[lang] = path
    return paths


def _devtools(port: int, path: str, method: str = "GET") -> Any:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method)
    with urllib.request.urlopen(request, timeout=5) as response:
        data = response.read()
    return json.loads(data) if data else None


class Tab:
    def __init__(self, websocket_url: str):
        self.websocket_url = websocket_url
        self._id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self.events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def __aenter__(self):
        self.socket = await websockets.connect(self.websocket_url, max_size=None)
        self.reader = asyncio.create_task(self._read())
        return self

    async def __aexit__(self, *_args):
        self.reader.cancel()
        await self.socket.close()

    async def _read(self) -> None:
        async for raw in self.socket:
            message = json.loads(raw)
            message_id = message.get("id")
            if message_id in self._pending:
                future = self._pending.pop(message_id)
                if "error" in message:
                    future.set_exception(RuntimeError(str(message["error"])))
                else:
                    future.set_result(message.get("result", {}))
            elif "method" in message:
                await self.events.put(message)

    async def call(self, method: str, **params) -> dict[str, Any]:
        self._id += 1
        message_id = self._id
        future = asyncio.get_running_loop().create_future()
        self._pending[message_id] = future
        await self.socket.send(json.dumps({
            "id": message_id, "method": method, "params": params,
        }))
        return await asyncio.wait_for(future, 15)

    async def js(self, expression: str, *, user_gesture: bool = False) -> Any:
        result = await self.call(
            "Runtime.evaluate", expression=expression, awaitPromise=True,
            returnByValue=True, userGesture=user_gesture)
        if result.get("exceptionDetails"):
            raise RuntimeError(str(result["exceptionDetails"]))
        return result.get("result", {}).get("value")


OBSERVER = r"""(() => {
  window.__acceptance = {captions: [], plays: [], closes: []};
  const seen = new WeakSet();
  const scan = () => document.querySelectorAll('.msg:not(.live)').forEach(node => {
    if (seen.has(node)) return;
    const lead = node.querySelector('.lead').textContent;
    if (!lead) return;
    seen.add(node);
    window.__acceptance.captions.push({
      who: node.querySelector('.who').textContent,
      lead,
      sub: node.querySelector('.sub').textContent,
      mine: node.classList.contains('mine'),
      at: performance.now()
    });
  });
  new MutationObserver(scan).observe(document.getElementById('captions'), {
    childList: true, subtree: true, characterData: true, attributes: true
  });
  fallbackAudio.addEventListener('playing', async () => {
    if (!fallbackAudio.src.startsWith('blob:')) return;
    const event = {type: 'playing', at: performance.now(), audio_base64: null};
    window.__acceptance.plays.push(event);
    try {
      // Clone the already-created production Blob URL. This does not replace
      // the network fetch or media playback, and unlike DevTools response-body
      // capture it works through the page's no-store Service Worker.
      const bytes = new Uint8Array(await (await fetch(fallbackAudio.src)).arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      event.audio_base64 = btoa(binary);
    } catch (error) {
      event.audio_error = error.name;
    }
  });
  fallbackAudio.addEventListener('ended', () => {
    if (!fallbackAudio.src.startsWith('blob:')) return;
    window.__acceptance.plays.push({
      type: 'ended', at: performance.now(), duration: fallbackAudio.duration,
      currentTime: fallbackAudio.currentTime
    });
  });
  let observedSocket = null;
  setInterval(() => {
    if (!ws || ws === observedSocket) return;
    observedSocket = ws;
    ws.addEventListener('close', event => window.__acceptance.closes.push({
      code: event.code, reason: event.reason, at: performance.now()
    }));
  }, 100);
  return true;
})()"""


class NetworkTTS:
    def __init__(self, tab: Tab):
        self.tab = tab
        self.requests: dict[str, dict[str, Any]] = {}
        self.responses: dict[str, dict[str, Any]] = {}
        self.errors: list[str] = []
        self.task: asyncio.Task | None = None

    async def start(self) -> None:
        await self.tab.call("Network.enable", maxTotalBufferSize=20_000_000,
                            maxResourceBufferSize=5_000_000)
        self.task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)

    async def _run(self) -> None:
        while True:
            event = await self.tab.events.get()
            method = event["method"]
            params = event.get("params", {})
            request_id = params.get("requestId")
            if method == "Network.requestWillBeSent":
                request = params.get("request", {})
                if urllib.parse.urlparse(request.get("url", "")).path != "/tts":
                    continue
                try:
                    body = json.loads(request.get("postData", "{}"))
                except json.JSONDecodeError:
                    body = {}
                # Do not retain headers: they contain the private room bearer.
                self.requests[request_id] = {"body": body}
            elif method == "Network.responseReceived" and request_id in self.requests:
                response = params.get("response", {})
                self.requests[request_id]["status"] = response.get("status")
                self.requests[request_id]["mime"] = response.get("mimeType")
            elif method == "Network.loadingFinished" and request_id in self.requests:
                self.responses[request_id] = self.requests[request_id]


def _launch_chrome(profile: Path, port: int, room_url: str,
                   microphone: Path, position: int) -> subprocess.Popen:
    return subprocess.Popen([
        CHROME,
        f"--user-data-dir={profile}",
        f"--remote-debugging-port={port}",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        f"--use-file-for-fake-audio-capture={microphone.resolve()}",
        "--no-first-run", "--no-default-browser-check",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        f"--window-position={position},40", "--window-size=430,820",
        room_url,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def _wait_devtools(port: int, room_url: str) -> dict[str, Any]:
    for _ in range(80):
        try:
            pages = [page for page in _devtools(port, "/json/list")
                     if page.get("type") == "page"
                     and page.get("url", "").startswith(room_url)]
            if pages:
                return pages[0]
        except Exception:
            pass
        await asyncio.sleep(0.25)
    raise RuntimeError(f"Chrome DevTools did not start on port {port}")


async def _wait_js(tab: Tab, expression: str, timeout: float = 20) -> Any:
    deadline = time.monotonic() + timeout
    value = None
    while time.monotonic() < deadline:
        value = await tab.js(expression)
        if value:
            return value
        await asyncio.sleep(0.25)
    raise TimeoutError(f"browser condition did not become true: {value!r}")


async def _selected_ice(tab: Tab) -> dict[str, Any]:
    return await tab.js(r"""(async () => {
      const state = [...peers.values()][0];
      if (!state) return null;
      let selected = null;
      const stats = await state.pc.getStats();
      stats.forEach(value => {
        if (value.type !== 'candidate-pair' || value.state !== 'succeeded') return;
        const local = stats.get(value.localCandidateId);
        const remote = stats.get(value.remoteCandidateId);
        selected = {
          local: local && local.candidateType,
          remote: remote && remote.candidateType,
          protocol: local && local.protocol
        };
      });
      return selected;
    })()""")


def _assert_caption_semantics(captions: list[dict[str, Any]], device_lang: str) -> None:
    assert len(captions) == len(SEMANTIC_TURNS), (
        f"{device_lang} device received {len(captions)} finals, expected 6")
    for index, (caption, turn) in enumerate(zip(captions, SEMANTIC_TURNS), 1):
        if turn.lang == device_lang:
            original, translated = caption["lead"], ""
            assert caption["mine"], f"turn {index} should be local on {device_lang}"
            assert not caption["sub"], (
                f"turn {index} leaked an outbound translation onto its own device")
        else:
            translated, original = caption["lead"], caption["sub"]
            assert not caption["mine"], f"turn {index} should be incoming on {device_lang}"
        assert _has_concepts(original, turn.original_concepts), (
            f"turn {index} ASR semantic mismatch: {original!r}")
        if turn.lang != device_lang:
            assert _has_concepts(translated, turn.translation_concepts), (
                f"turn {index} MT semantic mismatch: {translated!r}")
        print(json.dumps({
            "event": "caption", "turn": index, "speaker_lang": turn.lang,
            "device_lang": device_lang, "original": original,
            "incoming_translation": translated,
        }, ensure_ascii=False), flush=True)


def _assert_tts(network: NetworkTTS, plays: list[dict[str, Any]],
                listener_lang: str) -> list[dict[str, Any]]:
    assert not network.errors, f"{listener_lang} response capture errors: {network.errors}"
    records = list(network.responses.values())
    assert len(records) == 3, (
        f"{listener_lang} listener received {len(records)} real TTS WAVs, expected 3")
    ended = [event for event in plays if event.get("type") == "ended"]
    playing = [event for event in plays if event.get("type") == "playing"]
    assert len(playing) == 3 and len(ended) == 3, (
        f"{listener_lang} playback events were playing={len(playing)}, ended={len(ended)}")
    audited = []
    for index, record in enumerate(records, 1):
        request = record["body"]
        assert record.get("status") == 200 and record.get("mime") == "audio/wav"
        assert request.get("lang") == listener_lang
        assert isinstance(request.get("text"), str) and request["text"]
        playing_event = playing[index - 1]
        assert not playing_event.get("audio_error")
        assert playing_event.get("audio_base64"), "playing Blob WAV was not copied"
        audio = base64.b64decode(playing_event["audio_base64"], validate=True)
        metadata = _wav_metadata(audio)
        play = ended[index - 1]
        assert play["duration"] > 0.25 and play["currentTime"] > 0.20
        value = {
            "event": "tts_playback", "listener_lang": listener_lang,
            "target_lang": request["lang"], "text": request["text"],
            "voice_style": request.get("voice_style"),
            "played_duration_s": round(play["currentTime"], 3),
            **{key: metadata[key] for key in
               ("sample_rate", "frames", "duration_s", "rms", "sha256")},
            "audio": audio,
        }
        print(json.dumps({key: value[key] for key in value if key != "audio"},
                         ensure_ascii=False), flush=True)
        audited.append(value)
    return audited


async def _acoustic_audit(audio: bytes, lang: str,
                          concepts: tuple[tuple[str, ...], ...]) -> str:
    _room_url, token = await asyncio.to_thread(_room)
    speaker, _speaker_id = await _joined_socket(token, lang)
    listener, _listener_id = await _joined_socket(token, "es" if lang == "en" else "en")
    pcm = _resample_wav(audio, ASR_RATE)

    async def wait_final() -> str:
        while True:
            raw = await listener.recv()
            if not isinstance(raw, str):
                continue
            message = json.loads(raw)
            if (message.get("type") == "caption" and message.get("final")
                    and message.get("original")):
                return message["original"]

    result = asyncio.create_task(wait_final())
    try:
        started = time.monotonic()
        for number, offset in enumerate(range(0, len(pcm), FRAME_SAMPLES), 1):
            await speaker.send(pcm[offset:offset + FRAME_SAMPLES].tobytes())
            await asyncio.sleep(max(0, started + number * 0.1 - time.monotonic()))
        await speaker.send(json.dumps({"type": "speech_end"}))
        transcript = await asyncio.wait_for(result, 60)
        assert _has_concepts(transcript, concepts), (
            f"{lang} TTS acoustic language audit failed: {transcript!r}")
        return transcript
    finally:
        result.cancel()
        await speaker.close(1000, "audit complete")
        await listener.close(1000, "audit complete")


async def run(screenshot: Path | None) -> None:
    if not Path(CHROME).exists():
        raise FileNotFoundError(CHROME)
    temp_root = Path(tempfile.mkdtemp(prefix="real-bilingual-"))
    processes: list[subprocess.Popen] = []
    try:
        microphones = await _generate_microphone_timelines(temp_root)
        room_url, _token = await asyncio.to_thread(_room)
        ports = (9561, 9562)
        processes = [
            _launch_chrome(temp_root / "profile-en", ports[0], room_url,
                           microphones["en"], 20),
            _launch_chrome(temp_root / "profile-es", ports[1], room_url,
                           microphones["es"], 480),
        ]
        pages = await asyncio.gather(*(
            _wait_devtools(port, room_url) for port in ports))
        async with Tab(pages[0]["webSocketDebuggerUrl"]) as english, \
                   Tab(pages[1]["webSocketDebuggerUrl"]) as spanish:
            tabs = {"en": english, "es": spanish}
            networks = {lang: NetworkTTS(tab) for lang, tab in tabs.items()}
            for tab in tabs.values():
                await tab.call("Runtime.enable")
                await tab.call("Page.enable")
                await _wait_js(tab,
                    "document.readyState === 'complete' && typeof $ === 'function' "
                    "&& !!$('captions') && !!$('roleGate')")
                await tab.js(OBSERVER)
            await asyncio.gather(*(network.start() for network in networks.values()))

            initial = await asyncio.gather(*(tab.js(
                "({myLang, socket: typeof ws === 'undefined' ? null : ws, "
                "gate: !$('roleGate').hidden})") for tab in tabs.values()))
            assert all(value == {"myLang": None, "socket": None, "gate": True}
                       for value in initial), f"role gate did not hold join: {initial}"

            if screenshot:
                await english.call("Emulation.setDeviceMetricsOverride", width=360,
                                   height=780, deviceScaleFactor=1, mobile=True)
                image = await english.call("Page.captureScreenshot", format="png")
                screenshot.write_bytes(base64.b64decode(image["data"]))
                await english.call("Emulation.clearDeviceMetricsOverride")

            await asyncio.gather(
                english.js("document.querySelector('[data-lang=\"en\"]').click()",
                           user_gesture=True),
                spanish.js("document.querySelector('[data-lang=\"es\"]').click()",
                           user_gesture=True),
            )
            await asyncio.gather(*(_wait_js(
                tab, "myId && peers.size === 1 && ws.readyState === WebSocket.OPEN")
                for tab in tabs.values()))
            role_state = await asyncio.gather(*(tab.js(
                "({myLang, peerLangs:[...peers.values()].map(peer=>peer.lang), "
                "summary:$('roleSummary').textContent})") for tab in tabs.values()))
            assert role_state[0]["myLang"] == "en" and role_state[0]["peerLangs"] == ["es"]
            assert role_state[1]["myLang"] == "es" and role_state[1]["peerLangs"] == ["en"]
            print(json.dumps({"event": "explicit_roles", "devices": role_state},
                             ensure_ascii=False), flush=True)

            await asyncio.gather(*(tab.js(
                "$('voiceBtn').click(); $('micBtn').click(); true",
                user_gesture=True) for tab in tabs.values()))
            await asyncio.gather(*(_wait_js(
                tab, "micOn && workletNode instanceof AudioWorkletNode && voiceOn")
                for tab in tabs.values()))
            conversation_started = time.monotonic()

            deadline = conversation_started + SEMANTIC_TURNS[-1].at_s + 80
            last_progress = 0.0
            while time.monotonic() < deadline:
                states = await asyncio.gather(*(tab.js(
                    "({socket:ws.readyState, peers:peers.size, "
                    "finals:window.__acceptance.captions.length, "
                    "ended:window.__acceptance.plays.filter(e=>e.type==='ended').length, "
                    "closes:window.__acceptance.closes})") for tab in tabs.values()))
                if any(state["socket"] != 1 or state["peers"] != 1
                       or state["closes"] for state in states):
                    raise AssertionError(f"room became unstable: {states}")
                elapsed = time.monotonic() - conversation_started
                if elapsed - last_progress >= 20:
                    print(json.dumps({
                        "event": "conversation_progress", "elapsed_s": round(elapsed, 1),
                        "devices": states,
                    }), flush=True)
                    last_progress = elapsed
                if all(state["finals"] == 6 and state["ended"] == 3
                       for state in states):
                    break
                await asyncio.sleep(1)
            else:
                raise TimeoutError("six real turns and translated playback did not complete")

            elapsed = time.monotonic() - conversation_started
            assert elapsed >= MIN_CONVERSATION_SECONDS, (
                f"conversation ended before the lease-duration gate: {elapsed:.1f}s")
            page_results = {
                lang: await tab.js("window.__acceptance") for lang, tab in tabs.items()
            }
            for lang in ("en", "es"):
                _assert_caption_semantics(page_results[lang]["captions"], lang)

            tts_outputs: dict[str, list[dict[str, Any]]] = {}
            for lang in ("en", "es"):
                tts_outputs[lang] = _assert_tts(
                    networks[lang], page_results[lang]["plays"], lang)

            ice = {lang: await _selected_ice(tab) for lang, tab in tabs.items()}
            assert all(value for value in ice.values()), f"no selected ICE pair: {ice}"
            print(json.dumps({
                "event": "sustained_room", "conversation_s": round(elapsed, 1),
                "selected_ice": ice, "turns": 6, "socket_close_events": [],
            }), flush=True)

            previous_id = await spanish.js("myId")
            await spanish.call("Page.setWebLifecycleState", state="frozen")
            print(json.dumps({"event": "background_frozen", "seconds": BACKGROUND_SECONDS}),
                  flush=True)
            await asyncio.sleep(BACKGROUND_SECONDS)
            foreground = await english.js(
                "({socket:ws.readyState, peers:peers.size, count:$('participantCount').textContent})")
            assert foreground["socket"] == 1 and foreground["peers"] == 1
            await spanish.call("Page.setWebLifecycleState", state="active")
            resumed_id = await _wait_js(spanish,
                "ws.readyState === WebSocket.OPEN && peers.size === 1 "
                "&& $('participantCount').textContent === '2 / 4 people' && myId")
            await _wait_js(english,
                f"ws.readyState === WebSocket.OPEN && peers.size === 1 "
                f"&& peers.has({json.dumps(resumed_id)}) "
                "&& $('participantCount').textContent === '2 / 4 people'")
            lifecycle_closes = await spanish.js("window.__acceptance.closes")
            resume_state = await asyncio.gather(*(tab.js(
                "({socket:ws.readyState, peers:peers.size, "
                "count:$('participantCount').textContent})") for tab in tabs.values()))
            print(json.dumps({
                "event": "background_resumed", "seconds": BACKGROUND_SECONDS,
                "participant_count": "2 / 4 people",
                "same_participant": resumed_id == previous_id,
                "rejoined": resumed_id != previous_id,
                "close_events": lifecycle_closes,
                "devices": resume_state,
            }), flush=True)

            await asyncio.gather(*(network.stop() for network in networks.values()))

        # Verify that one exact WAV captured from each listener's actual network
        # response contains speech in the requested language.  This is an
        # independent ASR pass, not a trust in the request label alone.
        en_audio = tts_outputs["en"][0]
        es_audio = tts_outputs["es"][0]
        # Capture order follows the incoming turns for each listener: the
        # English listener first receives turn 2; the Spanish listener turn 1.
        en_transcript = await _acoustic_audit(
            en_audio["audio"], "en", (("hello", "hi"), ("david",), ("thank",)))
        es_transcript = await _acoustic_audit(
            es_audio["audio"], "es", (("hola",), ("maria",), ("hoy",)))
        print(json.dumps({
            "event": "tts_acoustic_language_audit",
            "en_listener_heard": en_transcript,
            "es_listener_heard": es_transcript,
        }, ensure_ascii=False), flush=True)
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(temp_root, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--screenshot", type=Path)
    args = parser.parse_args()
    if args.screenshot:
        args.screenshot.parent.mkdir(parents=True, exist_ok=True)
    asyncio.run(run(args.screenshot))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

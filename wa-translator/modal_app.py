"""Authenticated Modal compute adapter for the cloud caption room.

Cloudflare owns rooms, presence, signalling and caption fan-out.  This module
is deliberately stateless between WebSocket processes: each connection owns
one decoder/endpointer, and a replacement process simply starts that stream
again.  Natural WebRTC media never passes through Modal.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import re
import secrets
import sys
import threading
import time
import wave
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol

import numpy as np
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from starlette.websockets import WebSocketDisconnect

# The source tree colocates helpers in ``windows/``.  The deployed Modal image
# deliberately installs just those audited helpers at /root/windows so the
# heavyweight build context does not become a second copy of the app.  Resolve
# the exact image layout first, with the source layout as the local-test path.
WINDOWS_DIR = (Path("/root/windows") if Path("/root/windows/language_catalog.py").is_file()
               else Path(__file__).with_name("windows"))
sys.path.insert(0, str(WINDOWS_DIR))
import language_catalog

try:  # Local unit tests do not need a Modal account or SDK.
    import modal
except ModuleNotFoundError:  # pragma: no cover - exercised by import itself
    modal = None


CATALOG = language_catalog.public_catalog()
LANGUAGES = tuple(CATALOG["model_live_speech_languages"])
M2M_LANGUAGE_CODES = frozenset(entry["code"] for entry in CATALOG["languages"])
CATALOG_REVISION = CATALOG["revision"]
M2M100_REVISION = CATALOG["models"]["mt"]["revision"]
VOICE_ARTIFACT_SHA256 = CATALOG["models"]["tts"]["release_voice_artifact_sha256"]
FIXTURE_PATH = (Path("/root/multilingual_fixtures.json")
                if Path("/root/multilingual_fixtures.json").is_file()
                else Path(__file__).with_name("multilingual_fixtures.json"))
FIXTURE_DOCUMENT = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
MT_RECEIPT_FIXTURES = {
    fixture["id"]: fixture for fixture in FIXTURE_DOCUMENT["fixtures"]
}
if (len(MT_RECEIPT_FIXTURES) != len(FIXTURE_DOCUMENT["fixtures"])
        or any(not isinstance(fixture.get("id"), str)
               or fixture.get("source_language") not in M2M_LANGUAGE_CODES
               or fixture.get("target_language") not in M2M_LANGUAGE_CODES
               or not isinstance(fixture.get("source_text"), str)
               or len(fixture["source_text"]) > 300
               for fixture in FIXTURE_DOCUMENT["fixtures"])):
    raise RuntimeError("invalid multilingual model-receipt fixture catalog")


def _live_voice_routes() -> dict[str, dict[str, str]]:
    """Profiles reachable from release live-speech locales, with no fallback."""
    routes: dict[str, dict[str, str]] = {}
    for locale in CATALOG["locales"]:
        if locale["language"] not in LANGUAGES:
            continue
        for voice in locale["voice_profiles"]:
            route = {
                "pipeline": voice["pipeline"],
                "model_voice": voice["model_voice"],
            }
            existing = routes.setdefault(voice["id"], route)
            if existing != route:
                raise RuntimeError(f"voice profile has inconsistent catalog route: {voice['id']}")
    return routes


VOICE_ROUTES = _live_voice_routes()
if set(VOICE_ARTIFACT_SHA256) != set(VOICE_ROUTES):
    raise RuntimeError("catalog release voice checksums must exactly match enabled voice profiles")
TTS_WARMUP_FIXTURES = (
    ("Hi David, I'm fine, thank you.", "en-us-af-heart"),
    ("Good morning. The room is ready.", "en-gb-bf-emma"),
    ("Hola María, ¿cómo estás hoy?", "es-ef-dora"),
    ("Bonjour, la salle est prête.", "fr-ff-siwis"),
)

SAMPLE_RATE = 16_000
MAX_PCM_FRAME_BYTES = 32_000
MAX_CONTROL_BYTES = 8_192
MAX_STREAM_ID_CHARS = 64
MAX_CAPTION_CHARS = 300
MAX_CHAT_CHARS = 200
MAX_TTS_BODY_BYTES = 2_048
MAX_TRANSLATE_BODY_BYTES = 512
MAX_TTS_CHARS = 300
MAX_TTS_AUDIO_BYTES = 4 * 1024 * 1024
MAX_DIAGNOSTIC_CHARS = 240
# Operator-tunable end-of-utterance silence, clamped to a range that still ends
# an utterance without cutting one in half.  Mirrored in translation_server.py.
END_SILENCE_MS = max(200, min(1500, int(os.environ.get("LANG_ROOM_END_SILENCE_MS") or "500")))
PARTIAL_EVERY_S = 0.4
MIN_PARTIAL_S = 0.8
MAX_UTTERANCE_S = 15.0
IDLE_DROP_S = 3.0
MAX_STREAM_INPUTS = 4
MAX_TTS_INPUTS = 1
COMPUTE_CAPACITY_RETRY_MS = 1_000

MODEL_ROOT = Path(os.environ.get("LANG_ROOM_MODEL_ROOT", "/model-cache/lang-room"))
KOKORO_REPO = "hexgrad/Kokoro-82M"
KOKORO_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
KOKORO_MODEL_SHA256 = "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4"
WHISPER_REPO = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
WHISPER_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"


class Compute(Protocol):
    def transcribe_translate(
        self, pcm: np.ndarray, source_lang: str, target_langs: list[str],
        stream_id: str, final: bool,
    ) -> tuple[str, dict[str, str]]: ...

    def translate_text(
        self, text: str, source_lang: str, target_langs: list[str],
    ) -> dict[str, str]: ...


class TTS(Protocol):
    def synthesize(self, text: str, voice_profile: str) -> bytes: ...


class ModelInitializationError(RuntimeError):
    """Marks failures that occur before any participant audio is decoded."""

    def __init__(self, cause: Exception) -> None:
        self.cause_type = type(cause).__name__
        super().__init__(str(cause))


def _bounded_diagnostic(error: Exception, *hidden: str) -> str:
    """Return useful model-startup context without logging request content."""
    message = " ".join(str(error).split())
    for value in hidden:
        if value:
            message = message.replace(value, "[redacted]")
    message = re.sub(
        r"(?i)(bearer\s+|(?:token|secret|password|credential)\s*[=:]\s*)\S+",
        r"\1[redacted]",
        message,
    )
    message = re.sub(r"(https?://[^?\s]+)\?\S+", r"\1?[redacted]", message)
    cause_type = (error.cause_type if isinstance(error, ModelInitializationError)
                  else type(error).__name__)
    return f"{cause_type}: {message[:MAX_DIAGNOSTIC_CHARS]}"


def _translate_receipt_fixture(fixture: dict[str, Any]) -> dict[str, Any]:
    """Run only a fixed, authenticated MT receipt fixture; never arbitrary text."""
    import mt_ct2

    translated, reason = mt_ct2.translate_many(
        fixture["source_text"], fixture["source_language"],
        [fixture["target_language"]],
        stream_id=f"receipt-{fixture['id']}-{time.monotonic_ns()}", final=True,
    )
    text = translated.get(fixture["target_language"], "")
    if not text:
        raise RuntimeError(f"M2M100 receipt translation unavailable: {reason}")
    normalized = text.casefold()
    groups = fixture["semantic_token_groups"]
    return {
        "fixture_id": fixture["id"],
        "source_language": fixture["source_language"],
        "target_language": fixture["target_language"],
        "translation": text,
        "semantic_token_group_matches": [
            any(token.casefold() in normalized for token in group) for group in groups
        ],
        "model": mt_ct2.model_receipt(),
    }


class InputCapacity:
    """Container-local admission: four long streams plus one bounded TTS job."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._streams = 0
        self._tts = 0

    def try_stream(self) -> bool:
        with self._lock:
            if self._streams >= MAX_STREAM_INPUTS:
                return False
            self._streams += 1
            return True

    def release_stream(self) -> None:
        with self._lock:
            self._streams = max(0, self._streams - 1)

    def try_tts(self) -> bool:
        with self._lock:
            if self._tts >= MAX_TTS_INPUTS:
                return False
            self._tts += 1
            return True

    def release_tts(self) -> None:
        with self._lock:
            self._tts = max(0, self._tts - 1)


class ModelRuntime:
    """Lazy shared ASR/MT models; individual stream state lives elsewhere."""

    def __init__(self) -> None:
        self._asr: Any = None
        self._load_lock = __import__("threading").RLock()

    def _ensure_loaded(self) -> None:
        if self._asr is not None:
            return
        with self._load_lock:
            if self._asr is not None:
                return
            if str(WINDOWS_DIR) not in sys.path:
                sys.path.insert(0, str(WINDOWS_DIR))
            # The receiver also lazily imports faster_whisper.vad on its first
            # PCM frame.  Initialize that shared import path here before
            # importing another faster_whisper submodule, avoiding a cold-start
            # race through a partially initialized package.
            from endpointer import prime_vad_import
            prime_vad_import()
            from faster_whisper.utils import download_model
            from asr_whisper import WhisperASR
            import mt_ct2

            whisper_dir = MODEL_ROOT / "whisper" / WHISPER_REVISION
            whisper_dir.mkdir(parents=True, exist_ok=True)
            download_model(
                WHISPER_REPO,
                output_dir=str(whisper_dir),
                revision=WHISPER_REVISION,
            )
            self._asr = WhisperASR(model=str(whisper_dir))
            mt_ct2.preload()

    def transcribe_translate(
        self, pcm: np.ndarray, source_lang: str, target_langs: list[str],
        stream_id: str, final: bool,
    ) -> tuple[str, dict[str, str]]:
        try:
            self._ensure_loaded()
        except ModelInitializationError:
            raise
        except Exception as error:
            raise ModelInitializationError(error) from error
        import mt_ct2

        asr_lang = language_catalog.asr_language(source_lang)
        if not asr_lang:
            raise RuntimeError("unsupported ASR source language")
        original = self._asr.transcribe(pcm, asr_lang, partial=not final)
        translated: dict[str, str] = {}
        if original:
            translated, _reason = mt_ct2.translate_many(
                original, source_lang, target_langs, stream_id=stream_id, final=final)
        return original[:MAX_CAPTION_CHARS], {
            language: value[:MAX_CAPTION_CHARS] for language, value in translated.items()
        }

    def translate_text(
        self, text: str, source_lang: str, target_langs: list[str],
    ) -> dict[str, str]:
        # One initialization path only; ``_ensure_loaded`` serializes the GPU
        # stack imports that a concurrent cold start would otherwise interleave.
        self._ensure_loaded()
        import mt_ct2

        # ``final=False`` on purpose: the final path dedups against the stream's
        # ``_previous`` caption, which would swallow a typed message the sender
        # deliberately repeats.
        translated, _reason = mt_ct2.translate_many(
            text, source_lang, target_langs, stream_id="chat", final=False)
        return {language: value[:MAX_CAPTION_CHARS]
                for language, value in translated.items()}

    def preload(self) -> None:
        started = time.monotonic()
        self._ensure_loaded()
        elapsed_ms = round((time.monotonic() - started) * 1_000)
        region = os.environ.get("MODAL_REGION", "local")
        print(f"[compute] preload ready elapsed_ms={elapsed_ms} region={region}",
              flush=True)


class KokoroTTS:
    """Explicit catalog voice-profile routes from one pinned Kokoro model."""

    def __init__(self) -> None:
        self._model: Any = None
        self._pipelines: dict[str, Any] = {}
        self._pipeline_factory: Callable[..., Any] | None = None
        self._snapshot: Path | None = None
        self._load_lock = __import__("threading").RLock()
        self._synthesis_lock = __import__("threading").RLock()

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            from huggingface_hub import snapshot_download
            from kokoro import KModel, KPipeline
            import torch

            local_dir = MODEL_ROOT / "kokoro" / KOKORO_REVISION
            local_dir.mkdir(parents=True, exist_ok=True)
            snapshot_download(
                KOKORO_REPO,
                revision=KOKORO_REVISION,
                local_dir=str(local_dir),
                allow_patterns=["config.json", "kokoro-v1_0.pth",
                                *(f"voices/{route['model_voice']}.pt"
                                  for route in VOICE_ROUTES.values())],
            )
            model_file = local_dir / "kokoro-v1_0.pth"
            digest = hashlib.sha256(model_file.read_bytes()).hexdigest()
            if not secrets.compare_digest(digest, KOKORO_MODEL_SHA256):
                raise RuntimeError("Kokoro model checksum mismatch")
            for route in VOICE_ROUTES.values():
                voice = route["model_voice"]
                if not (local_dir / "voices" / f"{voice}.pt").is_file():
                    raise RuntimeError(f"Kokoro voice missing: {voice}")
            for profile_id, route in VOICE_ROUTES.items():
                voice_file = local_dir / "voices" / f"{route['model_voice']}.pt"
                digest = hashlib.sha256(voice_file.read_bytes()).hexdigest()
                if not secrets.compare_digest(digest, VOICE_ARTIFACT_SHA256[profile_id]):
                    raise RuntimeError(f"Kokoro voice checksum mismatch: {profile_id}")

            device = "cuda" if torch.cuda.is_available() else "cpu"
            model = KModel(
                repo_id=str(local_dir),
                config=str(local_dir / "config.json"),
                model=str(model_file),
            ).to(device).eval()
            actual_device = next(model.parameters()).device.type
            if actual_device != device:
                raise RuntimeError(
                    f"Kokoro model placement failed: expected {device}, got {actual_device}")
            if os.environ.get("MODAL_IS_REMOTE") == "1" and actual_device != "cuda":
                raise RuntimeError("Kokoro CUDA unavailable in deployed L4 container")
            self._model = model
            self._snapshot = local_dir
            self._pipeline_factory = KPipeline
            print(f"[tts] Kokoro model ready device={actual_device}", flush=True)

    def synthesize(self, text: str, voice_profile: str) -> bytes:
        route = VOICE_ROUTES.get(voice_profile)
        if route is None:
            raise ValueError("unsupported Kokoro voice profile")
        with self._synthesis_lock:
            self._ensure_loaded()
            assert self._snapshot is not None and self._model is not None
            assert self._pipeline_factory is not None
            voice_name = route["model_voice"]
            voice_path = self._snapshot / "voices" / f"{voice_name}.pt"
            pipeline = self._pipelines.get(route["pipeline"])
            if pipeline is None:
                pipeline = self._pipeline_factory(
                    lang_code=route["pipeline"], repo_id=str(self._snapshot), model=self._model,
                )
                self._pipelines[route["pipeline"]] = pipeline
            chunks: list[np.ndarray] = []
            for result in pipeline(text, voice=str(voice_path)):
                audio = result.audio if hasattr(result, "audio") else result[2]
                if audio is not None:
                    chunks.append(np.asarray(audio, dtype=np.float32))
            if not chunks:
                raise RuntimeError("Kokoro produced no audio")
            samples = np.clip(np.concatenate(chunks), -1.0, 1.0)
            pcm = (samples * 32767).astype(np.int16).tobytes()
            output = io.BytesIO()
            with wave.open(output, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(24_000)
                wav_file.writeframes(pcm)
            result = output.getvalue()
            if len(result) > MAX_TTS_AUDIO_BYTES:
                raise RuntimeError("Kokoro output exceeded the response cap")
            return result

    def preload(self) -> None:
        started = time.monotonic()
        for text, voice_profile in TTS_WARMUP_FIXTURES:
            self.synthesize(text, voice_profile)
        elapsed_ms = round((time.monotonic() - started) * 1_000)
        print(f"[tts] Kokoro preload ready elapsed_ms={elapsed_ms}", flush=True)


@dataclass(frozen=True)
class CaptionJob:
    audio: np.ndarray
    seq: int
    final: bool
    onset: float


class LatestWinsQueue:
    """Never drops finals; retains only the most recent pending partial."""

    def __init__(self) -> None:
        self._finals: deque[CaptionJob] = deque()
        self._partial: CaptionJob | None = None
        self._ready = asyncio.Condition()

    async def put(self, job: CaptionJob) -> None:
        async with self._ready:
            if job.final:
                self._partial = None
                self._finals.append(job)
            else:
                self._partial = job
            self._ready.notify()

    async def get(self) -> CaptionJob:
        async with self._ready:
            await self._ready.wait_for(lambda: bool(self._finals) or self._partial is not None)
            if self._finals:
                return self._finals.popleft()
            assert self._partial is not None
            job, self._partial = self._partial, None
            return job


@dataclass
class StreamState:
    stream_id: str
    source_lang: str
    target_langs: list[str]
    endpointer: Any
    queue: LatestWinsQueue
    seq: int = 0
    onset: float = 0.0
    last_partial: float = 0.0


def _authorized(value: str | None, expected: str) -> bool:
    if not value or not value.startswith("Bearer ") or not expected:
        return False
    return secrets.compare_digest(value[7:], expected)


def _valid_start(value: object) -> dict[str, Any] | None:
    if not isinstance(value, dict) or value.get("type") != "start":
        return None
    stream_id = value.get("stream_id")
    source_lang = value.get("source_lang")
    source_locale = value.get("source_locale")
    target_langs = value.get("target_langs")
    catalog_revision = value.get("catalog_revision")
    mt_revision = value.get("mt_revision")
    if (not isinstance(stream_id, str) or not stream_id
            or len(stream_id) > MAX_STREAM_ID_CHARS
            or source_lang not in LANGUAGES
            or not isinstance(source_locale, str)
            or language_catalog.base_language(source_locale) != source_lang
            or not isinstance(target_langs, list)
            or len(target_langs) > 3
            or catalog_revision != CATALOG_REVISION
            or mt_revision != M2M100_REVISION
            or any(not isinstance(target, str) or target not in M2M_LANGUAGE_CODES
                   for target in target_langs)):
        return None
    # The shared catalog is authoritative. Compute opens for the explicit
    # Whisper-to-M2M model intersection; its verified tier stays separate.
    unique_targets = list(dict.fromkeys(target_langs))
    return {"stream_id": stream_id, "source_lang": source_lang,
            "target_langs": unique_targets}


async def _receive_initial(websocket: WebSocket) -> dict[str, Any] | None:
    message = await websocket.receive()
    raw = message.get("text")
    if not isinstance(raw, str) or len(raw.encode()) > MAX_CONTROL_BYTES:
        return None
    try:
        return _valid_start(json.loads(raw))
    except json.JSONDecodeError:
        return None


async def _receive_audio(websocket: WebSocket, state: StreamState) -> None:
    loop = asyncio.get_running_loop()
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return
        frame = message.get("bytes")
        if frame is not None:
            if not frame or len(frame) > MAX_PCM_FRAME_BYTES or len(frame) % 2:
                await websocket.close(code=1009, reason="invalid PCM frame")
                return
            pcm = np.frombuffer(frame, dtype="<i2").astype(np.float32) / 32768.0
            now = loop.time()
            if not state.endpointer.speech_seen:
                state.onset = now
            seen, silence_ms = state.endpointer.feed(pcm)
            if not seen:
                if state.endpointer.duration_ms >= IDLE_DROP_S * 1000:
                    state.endpointer.take()
                continue
            speech_s = state.endpointer.speech_ms / 1000
            if silence_ms >= END_SILENCE_MS or speech_s >= MAX_UTTERANCE_S:
                state.seq += 1
                await state.queue.put(CaptionJob(
                    state.endpointer.take(), state.seq, True, state.onset))
                state.onset = 0.0
                state.last_partial = 0.0
            elif (speech_s >= MIN_PARTIAL_S
                  and now - state.last_partial >= PARTIAL_EVERY_S):
                state.last_partial = now
                await state.queue.put(CaptionJob(
                    state.endpointer.pending(), state.seq + 1, False, state.onset))
            continue

        raw = message.get("text")
        if not isinstance(raw, str) or len(raw.encode()) > MAX_CONTROL_BYTES:
            await websocket.close(code=1008, reason="invalid control message")
            return
        try:
            control = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.close(code=1008, reason="invalid control message")
            return
        if not isinstance(control, dict) or control.get("type") != "speech_end":
            await websocket.close(code=1008, reason="invalid control message")
            return
        if state.endpointer.speech_seen:
            state.seq += 1
            await state.queue.put(CaptionJob(
                state.endpointer.take(), state.seq, True, state.onset or loop.time()))
            state.onset = 0.0
            state.last_partial = 0.0


async def _caption_worker(websocket: WebSocket, state: StreamState, compute: Compute) -> None:
    while True:
        job = await state.queue.get()
        # A final supersedes any older partial already executing.
        original, translations = await asyncio.to_thread(
            compute.transcribe_translate,
            job.audio,
            state.source_lang,
            state.target_langs,
            state.stream_id,
            job.final,
        )
        if not job.final and job.seq <= state.seq:
            continue
        await websocket.send_json({
            "type": "caption",
            "seq": job.seq,
            "final": job.final,
            "original": original[:MAX_CAPTION_CHARS],
            "translations": {language: value[:MAX_CAPTION_CHARS]
                             for language, value in translations.items()},
            "t_ms": max(0, round((asyncio.get_running_loop().time() - job.onset) * 1000)),
        })


async def _read_limited(request: Request, limit: int) -> bytes | None:
    length = request.headers.get("content-length")
    if length:
        try:
            if int(length) > limit:
                return None
        except ValueError:
            return None
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            return None
        body.extend(chunk)
    return bytes(body)


def create_api(
    *,
    shared_secret: str | None = None,
    compute: Compute | None = None,
    tts: TTS | None = None,
    endpointer_factory: Callable[[], Any] | None = None,
    capacity: InputCapacity | None = None,
) -> FastAPI:
    """Create the ASGI app. Explicit seams keep tests off GPU/model downloads."""
    secret = shared_secret if shared_secret is not None else os.environ.get(
        "MODAL_SHARED_SECRET", "")
    compute_engine = compute or ModelRuntime()
    tts_engine = tts or KokoroTTS()
    input_capacity = capacity or InputCapacity()
    preload_lock = threading.Lock()
    preload_started = False

    def start_model_preload() -> None:
        nonlocal preload_started
        with preload_lock:
            if preload_started:
                return
            preload_started = True

        def run() -> None:
            # Import and initialize the two GPU stacks serially.  Concurrent
            # cold imports can expose partially initialized extension modules.
            for name, engine in (("compute", compute_engine), ("tts", tts_engine)):
                preload = getattr(engine, "preload", None)
                if not callable(preload):
                    continue
                try:
                    preload()
                except Exception as error:
                    print(f"[{name}] preload {_bounded_diagnostic(error, secret)}",
                          file=sys.stderr, flush=True)

        threading.Thread(
            target=run, name="model-preload", daemon=True,
        ).start()
    if endpointer_factory is None:
        if str(WINDOWS_DIR) not in sys.path:
            sys.path.insert(0, str(WINDOWS_DIR))
        from endpointer import Endpointer
        endpointer_factory = Endpointer

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @api.get("/health")
    async def health(request: Request) -> Response:
        if not _authorized(request.headers.get("authorization"), secret):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        # An authenticated health check is the Worker's prewarm: the room is
        # created and shared before anyone speaks, so pay the cold start there.
        start_model_preload()
        return JSONResponse({"status": "ok", "languages": list(LANGUAGES),
                             "max_streams": MAX_STREAM_INPUTS,
                             "max_tts": MAX_TTS_INPUTS,
                             "catalog_revision": CATALOG_REVISION,
                             "mt_revision": M2M100_REVISION,
                             "voice_profiles": sorted(VOICE_ROUTES)})

    @api.get("/capabilities")
    async def capabilities(request: Request) -> Response:
        if not _authorized(request.headers.get("authorization"), secret):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return JSONResponse(language_catalog.public_catalog(),
                            headers={"Cache-Control": "no-store"})

    @api.post("/translate")
    async def translate_chat(request: Request) -> Response:
        """Typed-chat translation: bounded text, no ASR and no stream state."""
        if not _authorized(request.headers.get("authorization"), secret):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        body = await _read_limited(request, MAX_TRANSLATE_BODY_BYTES)
        if body is None:
            return JSONResponse({"error": "request body is too large"}, status_code=413)
        try:
            data = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JSONResponse({"error": "invalid JSON"}, status_code=400)
        if not isinstance(data, dict):
            return JSONResponse({"error": "invalid translate request"}, status_code=422)
        text = data.get("text")
        source_lang = data.get("source_lang")
        target_langs = data.get("target_langs")
        if (not isinstance(text, str) or not text.strip()
                or len(text) > MAX_CHAT_CHARS
                or not isinstance(source_lang, str)
                or source_lang not in M2M_LANGUAGE_CODES
                or not isinstance(target_langs, list)
                or not target_langs or len(target_langs) > 3
                or any(not isinstance(target, str) or target not in M2M_LANGUAGE_CODES
                       for target in target_langs)):
            return JSONResponse({"error": "invalid translate request"}, status_code=422)
        # A chat translate is a short bounded job on the same one GPU, so it
        # takes the existing TTS admission slot instead of adding a capacity
        # class the container cannot actually serve in parallel.
        if not input_capacity.try_tts():
            return JSONResponse({"error": "translate busy"}, status_code=429,
                                headers={"Retry-After": "1"})
        start_model_preload()
        try:
            translations = await asyncio.wait_for(
                asyncio.to_thread(compute_engine.translate_text,
                                  text.strip(), source_lang, target_langs),
                timeout=30)
        except Exception as error:
            print(f"[translate] {_bounded_diagnostic(error, secret, text)}",
                  file=sys.stderr, flush=True)
            return JSONResponse({"error": "translation unavailable"}, status_code=503)
        finally:
            # ponytail: the slot is returned on timeout even though the worker
            # thread may still be finishing — one bounded 30 s overlap. Adopt
            # the /tts shield+done_callback dance if chat ever runs long.
            input_capacity.release_tts()
        return JSONResponse({"translations": translations},
                            headers={"Cache-Control": "no-store"})

    @api.post("/mt-receipt")
    async def mt_receipt(request: Request) -> Response:
        """Authenticated, bounded pinned-MT receipt path used only at deploy time."""
        if not _authorized(request.headers.get("authorization"), secret):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        body = await _read_limited(request, 256)
        if body is None:
            return JSONResponse({"error": "request body is too large"}, status_code=413)
        try:
            data = json.loads(body)
            fixture_id = data.get("fixture_id") if isinstance(data, dict) else None
        except (json.JSONDecodeError, UnicodeDecodeError):
            fixture_id = None
        fixture = MT_RECEIPT_FIXTURES.get(fixture_id)
        if fixture is None:
            return JSONResponse({"error": "unknown model receipt fixture"}, status_code=422)
        try:
            receipt = await asyncio.wait_for(
                asyncio.to_thread(_translate_receipt_fixture, fixture), timeout=120)
        except Exception as error:
            print(f"[mt-receipt] {_bounded_diagnostic(error, secret)}",
                  file=sys.stderr, flush=True)
            return JSONResponse({"error": "M2M100 receipt unavailable"}, status_code=503)
        return JSONResponse(receipt, headers={"Cache-Control": "no-store"})

    @api.websocket("/stream")
    async def stream(websocket: WebSocket) -> None:
        if not _authorized(websocket.headers.get("authorization"), secret):
            await websocket.close(code=1008, reason="unauthorized")
            return
        if not input_capacity.try_stream():
            # There is one scale-to-zero L4 container. Accept long enough to
            # send a bounded, explicit global-capacity status; the Worker can
            # surface this to the affected speaker instead of silently losing
            # PCM while another room owns the four stream slots.
            await websocket.accept()
            await websocket.send_json({
                "type": "stream_status", "status": "capacity", "scope": "global",
                "retry_after_ms": COMPUTE_CAPACITY_RETRY_MS,
            })
            await websocket.close(code=1013, reason="stream capacity reached")
            return
        try:
            await websocket.accept()
            start = await _receive_initial(websocket)
            if start is None:
                await websocket.close(code=1008, reason="invalid start message")
                return
            start_model_preload()
            state = StreamState(
                **start,
                endpointer=endpointer_factory(),
                queue=LatestWinsQueue(),
            )
            receiver = asyncio.create_task(_receive_audio(websocket, state))
            worker = asyncio.create_task(_caption_worker(websocket, state, compute_engine))
            done, pending = await asyncio.wait(
                (receiver, worker), return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                # ``Task.exception`` re-raises ``CancelledError``. A peer
                # close is an ordinary stream terminal condition, not an
                # application failure that should poison the ASGI close path.
                if task.cancelled():
                    continue
                error = task.exception()
                if error and not isinstance(error, WebSocketDisconnect):
                    if isinstance(error, ModelInitializationError):
                        diagnostic = _bounded_diagnostic(error, secret)
                    else:
                        diagnostic = type(error).__name__
                    print(f"[stream] {diagnostic}", file=sys.stderr, flush=True)
                    try:
                        await websocket.close(code=1011, reason="compute stream failed")
                    except RuntimeError:
                        pass
        except (WebSocketDisconnect, asyncio.CancelledError):
            # ASGI transports may cancel the handler while closing a peer. The
            # stream has no durable work to preserve; release its capacity in
            # ``finally`` and do not surface a normal close as compute failure.
            return
        finally:
            input_capacity.release_stream()

    @api.post("/tts")
    async def tts_audio(request: Request) -> Response:
        if not _authorized(request.headers.get("authorization"), secret):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        body = await _read_limited(request, MAX_TTS_BODY_BYTES)
        if body is None:
            return JSONResponse({"error": "request body is too large"}, status_code=413)
        try:
            data = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JSONResponse({"error": "invalid JSON"}, status_code=400)
        if not isinstance(data, dict):
            return JSONResponse({"error": "invalid TTS request"}, status_code=422)
        text = data.get("text")
        voice_profile = data.get("voice_profile")
        if (not isinstance(text, str) or not text.strip()
                or len(text) > MAX_TTS_CHARS
                or not isinstance(voice_profile, str)
                or voice_profile not in VOICE_ROUTES):
            return JSONResponse({"error": "invalid TTS request"}, status_code=422)
        if not input_capacity.try_tts():
            return JSONResponse({"error": "TTS busy"}, status_code=429,
                                headers={"Retry-After": "1"})
        task = asyncio.create_task(
            asyncio.to_thread(tts_engine.synthesize, text.strip(), voice_profile))
        release_on_return = True
        try:
            audio = await asyncio.wait_for(asyncio.shield(task), timeout=60)
        except asyncio.TimeoutError:
            release_on_return = False
            task.add_done_callback(lambda _task: input_capacity.release_tts())
            return JSONResponse({"error": "TTS timeout"}, status_code=504)
        except asyncio.CancelledError:
            release_on_return = False
            task.add_done_callback(lambda _task: input_capacity.release_tts())
            raise
        except Exception as error:
            print(f"[tts] {_bounded_diagnostic(error, secret, text)}",
                  file=sys.stderr, flush=True)
            return JSONResponse({"error": "TTS unavailable"}, status_code=503)
        finally:
            if release_on_return:
                input_capacity.release_tts()
        if (not isinstance(audio, bytes) or not audio.startswith(b"RIFF")
                or len(audio) > MAX_TTS_AUDIO_BYTES):
            return JSONResponse({"error": "invalid TTS output"}, status_code=502)
        return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})

    return api


# Modal owns only authenticated compute.  One L4 container handles at most the
# room's four participant streams plus one bounded TTS request and scales all
# the way to zero.  The Volume
# persists downloaded model artefacts across cold starts.
if modal is not None:  # pragma: no branch - false only in the local test venv
    modal_image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("espeak-ng", "libsndfile1")
        .pip_install_from_requirements(
            str(Path(__file__).with_name("modal-runtime-requirements.txt")),
            extra_options="--require-hashes",
        )
        .env({
            "HOME": "/root",
            "HF_HOME": "/model-cache/huggingface",
            "LANG_ROOM_MODEL_ROOT": "/model-cache/lang-room",
            "MODAL_IS_REMOTE": "1",
            "LD_LIBRARY_PATH": "/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib",
        })
        .run_commands(
            "python -c \"import ctypes; ctypes.CDLL('libcublas.so.12'); "
            "ctypes.CDLL('libcudnn.so.9')\""
        )
        .add_local_file(str(Path(__file__)), "/root/wa-translator/modal_app.py")
        .add_local_file(str(Path(__file__).with_name("capabilities.json")),
                        "/root/capabilities.json")
        .add_local_file(str(Path(__file__).with_name("multilingual_fixtures.json")),
                        "/root/multilingual_fixtures.json")
        .add_local_file(str(Path(__file__).with_name("windows") / "language_catalog.py"),
                        "/root/windows/language_catalog.py")
        .add_local_file(str(Path(__file__).with_name("windows") / "asr_whisper.py"),
                        "/root/windows/asr_whisper.py")
        .add_local_file(str(Path(__file__).with_name("windows") / "cuda_dlls.py"),
                        "/root/windows/cuda_dlls.py")
        .add_local_file(str(Path(__file__).with_name("windows") / "endpointer.py"),
                        "/root/windows/endpointer.py")
        .add_local_file(str(Path(__file__).with_name("windows") / "mt_ct2.py"),
                        "/root/windows/mt_ct2.py")
    )
    modal_volume = modal.Volume.from_name("spoken-translation-model-cache",
                                          create_if_missing=True)
    modal_application = modal.App("spoken-translation-compute")

    # The previous default-routed deployment remains available in Modal/Git
    # history for rollback. Only this AP-routed function may allocate an L4 in
    # the active deployment, preserving the app's one-container beta ceiling.
    @modal_application.function(
        image=modal_image,
        gpu="L4",
        volumes={"/model-cache": modal_volume},
        secrets=[modal.Secret.from_name("spoken-translation-modal")],
        max_containers=1,
        min_containers=0,
        scaledown_window=60,
        timeout=86_400,
        routing_region="ap-south",
    )
    @modal.concurrent(max_inputs=5, target_inputs=5)
    @modal.asgi_app()
    def web_ap_south() -> FastAPI:
        return create_api()
else:
    modal_image = None
    modal_volume = None
    modal_application = None

# Modal's file-mode CLI resolves this conventional export.  It aliases the
# single descriptive App above; it does not create another function or GPU lane.
app = modal_application

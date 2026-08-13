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

try:  # Local unit tests do not need a Modal account or SDK.
    import modal
except ModuleNotFoundError:  # pragma: no cover - exercised by import itself
    modal = None


LANGUAGES = ("en", "es")
VOICE_STYLES = ("female", "male")
VOICE_ROUTES = {
    ("en", "female"): "af_heart",
    ("en", "male"): "am_michael",
    ("es", "female"): "ef_dora",
    ("es", "male"): "em_alex",
}

SAMPLE_RATE = 16_000
MAX_PCM_FRAME_BYTES = 32_000
MAX_CONTROL_BYTES = 8_192
MAX_STREAM_ID_CHARS = 64
MAX_CAPTION_CHARS = 300
MAX_TTS_BODY_BYTES = 2_048
MAX_TTS_CHARS = 300
MAX_TTS_AUDIO_BYTES = 4 * 1024 * 1024
MAX_DIAGNOSTIC_CHARS = 240
END_SILENCE_MS = 500
PARTIAL_EVERY_S = 0.4
MIN_PARTIAL_S = 0.8
MAX_UTTERANCE_S = 15.0
IDLE_DROP_S = 3.0
MAX_STREAM_INPUTS = 4
MAX_TTS_INPUTS = 1

MODEL_ROOT = Path(os.environ.get("LANG_ROOM_MODEL_ROOT", "/model-cache/lang-room"))
KOKORO_REPO = "hexgrad/Kokoro-82M"
KOKORO_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
KOKORO_MODEL_SHA256 = "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4"
WHISPER_REPO = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
WHISPER_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"


class Compute(Protocol):
    def transcribe_translate(
        self, pcm: np.ndarray, source_lang: str, target_lang: str,
        stream_id: str, final: bool,
    ) -> tuple[str, str]: ...


class TTS(Protocol):
    def synthesize(self, text: str, lang: str, voice_style: str) -> bytes: ...


class ModelInitializationError(RuntimeError):
    """Marks failures that occur before any participant audio is decoded."""

    def __init__(self, cause: Exception) -> None:
        self.cause_type = type(cause).__name__
        super().__init__(str(cause))


def _bounded_initialization_diagnostic(
    error: ModelInitializationError, shared_secret: str,
) -> str:
    """Return useful model-startup context without logging request content."""
    message = " ".join(str(error).split())
    if shared_secret:
        message = message.replace(shared_secret, "[redacted]")
    message = re.sub(
        r"(?i)(bearer\s+|(?:token|secret|password|credential)\s*[=:]\s*)\S+",
        r"\1[redacted]",
        message,
    )
    message = re.sub(r"(https?://[^?\s]+)\?\S+", r"\1?[redacted]", message)
    return f"{error.cause_type}: {message[:MAX_DIAGNOSTIC_CHARS]}"


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
            windows_dir = Path(__file__).with_name("windows")
            if str(windows_dir) not in sys.path:
                sys.path.insert(0, str(windows_dir))
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
        self, pcm: np.ndarray, source_lang: str, target_lang: str,
        stream_id: str, final: bool,
    ) -> tuple[str, str]:
        try:
            self._ensure_loaded()
        except ModelInitializationError:
            raise
        except Exception as error:
            raise ModelInitializationError(error) from error
        import mt_ct2

        original = self._asr.transcribe(pcm, source_lang, partial=not final)
        translated = ""
        if original:
            translated, _reason = mt_ct2.translate(
                original,
                f"{source_lang}-{target_lang}",
                stream_id=stream_id,
                final=final,
            )
        return original[:MAX_CAPTION_CHARS], translated[:MAX_CAPTION_CHARS]


class KokoroTTS:
    """Four controlled voice routes from one revision-pinned Kokoro model."""

    def __init__(self) -> None:
        self._model: Any = None
        self._pipelines: dict[str, Any] = {}
        self._snapshot: Path | None = None
        self._load_lock = __import__("threading").RLock()

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            from huggingface_hub import snapshot_download
            from kokoro import KModel, KPipeline

            local_dir = MODEL_ROOT / "kokoro" / KOKORO_REVISION
            local_dir.mkdir(parents=True, exist_ok=True)
            snapshot_download(
                KOKORO_REPO,
                revision=KOKORO_REVISION,
                local_dir=str(local_dir),
                allow_patterns=["config.json", "kokoro-v1_0.pth",
                                *(f"voices/{voice}.pt"
                                  for voice in VOICE_ROUTES.values())],
            )
            model_file = local_dir / "kokoro-v1_0.pth"
            digest = hashlib.sha256(model_file.read_bytes()).hexdigest()
            if not secrets.compare_digest(digest, KOKORO_MODEL_SHA256):
                raise RuntimeError("Kokoro model checksum mismatch")
            for voice in VOICE_ROUTES.values():
                if not (local_dir / "voices" / f"{voice}.pt").is_file():
                    raise RuntimeError(f"Kokoro voice missing: {voice}")

            self._model = KModel(
                repo_id=str(local_dir),
                config=str(local_dir / "config.json"),
                model=str(model_file),
            )
            self._snapshot = local_dir
            self._pipelines = {
                "en": KPipeline(lang_code="a", repo_id=str(local_dir),
                                model=self._model),
                "es": KPipeline(lang_code="e", repo_id=str(local_dir),
                                model=self._model),
            }

    def synthesize(self, text: str, lang: str, voice_style: str) -> bytes:
        self._ensure_loaded()
        assert self._snapshot is not None
        voice_name = VOICE_ROUTES[(lang, voice_style)]
        voice_path = self._snapshot / "voices" / f"{voice_name}.pt"
        chunks: list[np.ndarray] = []
        for result in self._pipelines[lang](text, voice=str(voice_path)):
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
    target_lang: str
    endpointer: Any
    queue: LatestWinsQueue
    seq: int = 0
    onset: float = 0.0
    last_partial: float = 0.0


def _authorized(value: str | None, expected: str) -> bool:
    if not value or not value.startswith("Bearer ") or not expected:
        return False
    return secrets.compare_digest(value[7:], expected)


def _valid_start(value: object) -> dict[str, str] | None:
    if not isinstance(value, dict) or value.get("type") != "start":
        return None
    stream_id = value.get("stream_id")
    source_lang = value.get("source_lang")
    target_lang = value.get("target_lang")
    if (not isinstance(stream_id, str) or not stream_id
            or len(stream_id) > MAX_STREAM_ID_CHARS
            or source_lang not in LANGUAGES or target_lang not in LANGUAGES
            or source_lang == target_lang):
        return None
    return {"stream_id": stream_id, "source_lang": source_lang,
            "target_lang": target_lang}


async def _receive_initial(websocket: WebSocket) -> dict[str, str] | None:
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
        original, translated = await asyncio.to_thread(
            compute.transcribe_translate,
            job.audio,
            state.source_lang,
            state.target_lang,
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
            "translations": ({state.target_lang: translated[:MAX_CAPTION_CHARS]}
                             if translated else {}),
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
    if endpointer_factory is None:
        windows_dir = Path(__file__).with_name("windows")
        if str(windows_dir) not in sys.path:
            sys.path.insert(0, str(windows_dir))
        from endpointer import Endpointer
        endpointer_factory = Endpointer

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @api.get("/health")
    async def health(request: Request) -> Response:
        if not _authorized(request.headers.get("authorization"), secret):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return JSONResponse({"status": "ok", "languages": list(LANGUAGES),
                             "max_streams": MAX_STREAM_INPUTS,
                             "max_tts": MAX_TTS_INPUTS})

    @api.websocket("/stream")
    async def stream(websocket: WebSocket) -> None:
        if not _authorized(websocket.headers.get("authorization"), secret):
            await websocket.close(code=1008, reason="unauthorized")
            return
        if not input_capacity.try_stream():
            await websocket.close(code=1013, reason="stream capacity reached")
            return
        try:
            await websocket.accept()
            start = await _receive_initial(websocket)
            if start is None:
                await websocket.close(code=1008, reason="invalid start message")
                return
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
                error = task.exception()
                if error and not isinstance(error, WebSocketDisconnect):
                    if isinstance(error, ModelInitializationError):
                        diagnostic = _bounded_initialization_diagnostic(error, secret)
                    else:
                        diagnostic = type(error).__name__
                    print(f"[stream] {diagnostic}", file=sys.stderr, flush=True)
                    try:
                        await websocket.close(code=1011, reason="compute stream failed")
                    except RuntimeError:
                        pass
        except WebSocketDisconnect:
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
        lang = data.get("lang")
        style = data.get("voice_style")
        if (not isinstance(text, str) or not text.strip()
                or len(text) > MAX_TTS_CHARS or lang not in LANGUAGES
                or style not in VOICE_STYLES):
            return JSONResponse({"error": "invalid TTS request"}, status_code=422)
        if not input_capacity.try_tts():
            return JSONResponse({"error": "TTS busy"}, status_code=429,
                                headers={"Retry-After": "1"})
        task = asyncio.create_task(
            asyncio.to_thread(tts_engine.synthesize, text.strip(), lang, style))
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
        except Exception:
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
            "LD_LIBRARY_PATH": "/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib",
        })
        .run_commands(
            "python -c \"import ctypes; ctypes.CDLL('libcublas.so.12'); "
            "ctypes.CDLL('libcudnn.so.9')\""
        )
        .add_local_file(str(Path(__file__)), "/root/wa-translator/modal_app.py")
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

    @modal_application.function(
        image=modal_image,
        gpu="L4",
        volumes={"/model-cache": modal_volume},
        secrets=[modal.Secret.from_name("spoken-translation-modal")],
        max_containers=1,
        min_containers=0,
        scaledown_window=60,
        timeout=86_400,
    )
    @modal.concurrent(max_inputs=5, target_inputs=5)
    @modal.asgi_app()
    def web() -> FastAPI:
        return create_api()
else:
    modal_image = None
    modal_volume = None
    modal_application = None

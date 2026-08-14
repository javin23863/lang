"""Permissively licensed local CPU voices for browser TTS fallback."""

import io
import hashlib
import os
import shutil
import tarfile
import tempfile
import threading
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx


# Both voices were trained from scratch on public-domain datasets. The runtime
# is Apache-2.0. Do not replace these with a Lessac-derived Piper voice: its
# research license excludes commercial voice-synthesis products.
MODEL_NAMES = {
    "en": "vits-piper-en_US-ljspeech-medium",
    "es": "vits-piper-es_ES-carlfm-x_low",
}
MODEL_FILES = {
    "en": "en_US-ljspeech-medium.onnx",
    "es": "es_ES-carlfm-x_low.onnx",
}
RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"
MODEL_ARCHIVES = {
    "en": {
        "size": 67_169_893,
        "sha256": "3dfb4b759d8be032a4903a9538d128b0fda2a06ab1de6cbc2d93a97e2dd83dba",
    },
    "es": {
        "size": 26_520_563,
        "sha256": "15585c5add2ab1915ce69e8c966c7c9fb0b6afb21f9b92f18110fda5a4787f99",
    },
}
MAX_ARCHIVE_BYTES = 80 * 1024 * 1024
MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 4096
DOWNLOAD_DEADLINE_S = 180
CACHE = Path(os.environ.get(
    "LANG_ROOM_TTS_CACHE", Path.home() / ".cache" / "lang-room" / "tts"))

_lock = threading.RLock()
_voices: dict[str, sherpa_onnx.OfflineTts] = {}
_errors: dict[str, str] = {}


def _safe_extract(archive: Path, destination: Path):
    root = destination.resolve()
    with tarfile.open(archive, "r:bz2") as bundle:
        members = []
        extracted_bytes = 0
        for member in bundle:
            if len(members) >= MAX_ARCHIVE_MEMBERS:
                raise ValueError("model archive contains too many members")
            members.append(member)
            normalized = member.name.replace("\\", "/")
            if (not normalized or normalized.startswith("/")
                    or ".." in normalized.split("/")
                    or len(normalized) > 512):
                raise ValueError(f"unsafe model archive member: {member.name}")
            if not (member.isfile() or member.isdir()):
                raise ValueError(f"unsafe model archive type: {member.name}")
            if not (destination / normalized).resolve().is_relative_to(root):
                raise ValueError(f"unsafe model archive member: {member.name}")
            extracted_bytes += member.size
            if member.size < 0 or extracted_bytes > MAX_EXTRACTED_BYTES:
                raise ValueError("model archive expands beyond the safety limit")
        bundle.extractall(destination, members=members)


def _download_verified(url: str, destination: Path, *, expected_size: int,
                       expected_sha256: str):
    if expected_size > MAX_ARCHIVE_BYTES:
        raise ValueError("pinned model archive exceeds the download limit")
    deadline = time.monotonic() + DOWNLOAD_DEADLINE_S
    digest = hashlib.sha256()
    total = 0
    try:
        with (urllib.request.urlopen(url, timeout=30) as source,
              destination.open("wb") as output):
            length = source.headers.get("Content-Length")
            if length:
                try:
                    announced = int(length)
                except ValueError as exc:
                    raise ValueError("invalid model Content-Length") from exc
                if announced > MAX_ARCHIVE_BYTES or announced != expected_size:
                    raise ValueError("model archive size does not match the pin")
            while True:
                if time.monotonic() > deadline:
                    raise TimeoutError("model archive download exceeded its deadline")
                chunk = source.read(min(1024 * 1024, MAX_ARCHIVE_BYTES - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_ARCHIVE_BYTES:
                    raise ValueError("model archive exceeds the download limit")
                digest.update(chunk)
                output.write(chunk)
        if total != expected_size or digest.hexdigest() != expected_sha256:
            raise ValueError("model archive failed pinned integrity verification")
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def _ensure_model(lang: str) -> Path:
    name = MODEL_NAMES[lang]
    target = CACHE / name
    required = (target / MODEL_FILES[lang], target / "tokens.txt",
                target / "espeak-ng-data")
    if all(path.exists() for path in required):
        return target

    CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=name + "-", dir=CACHE) as temp:
        temp_path = Path(temp)
        archive = temp_path / (name + ".tar.bz2")
        print(f"[tts] downloading {name}")
        pin = MODEL_ARCHIVES[lang]
        _download_verified(
            f"{RELEASE}/{name}.tar.bz2", archive,
            expected_size=pin["size"], expected_sha256=pin["sha256"])
        _safe_extract(archive, temp_path)
        extracted = temp_path / name
        if not extracted.is_dir():
            raise RuntimeError(f"model archive did not contain {name}")
        if target.exists():
            shutil.rmtree(target)
        shutil.move(str(extracted), str(target))
    return target


def _load(lang: str) -> sherpa_onnx.OfflineTts:
    if lang not in MODEL_NAMES:
        raise ValueError(f"unsupported TTS language: {lang}")
    with _lock:
        if lang not in _voices:
            model_dir = _ensure_model(lang)
            vits = sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(model_dir / MODEL_FILES[lang]),
                tokens=str(model_dir / "tokens.txt"),
                data_dir=str(model_dir / "espeak-ng-data"),
            )
            config = sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(
                    vits=vits, num_threads=min(4, os.cpu_count() or 1), provider="cpu"))
            if not config.validate():
                raise RuntimeError(f"invalid {lang} TTS model configuration")
            _voices[lang] = sherpa_onnx.OfflineTts(config)
            _errors.pop(lang, None)
        return _voices[lang]


def synthesize(text: str, lang: str) -> bytes:
    text = " ".join(text.split())
    if not text:
        raise ValueError("TTS text is empty")
    with _lock:
        audio = _load(lang).generate(text)
        samples = np.clip(audio.samples, -1, 1)
        pcm = (samples * 32767).astype(np.int16).tobytes()
        out = io.BytesIO()
        with wave.open(out, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(audio.sample_rate)
            wav_file.writeframes(pcm)
        return out.getvalue()


def preload():
    for lang in MODEL_NAMES:
        try:
            _load(lang)
        except Exception as exc:
            _errors[lang] = f"{type(exc).__name__}: {exc}"


def status() -> dict:
    return {lang: "ready" if lang in _voices else _errors.get(lang, "loading")
            for lang in MODEL_NAMES}

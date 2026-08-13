#!/usr/bin/env python3
"""Revision-pinned M2M100 CTranslate2 adapter for live room captions.

This module owns one shared many-to-many model.  A completed ASR transcript is
filtered once, tokenized once, then translated to each *unique* listener base
language in one batch.  Locale profiles are validated by ``language_catalog``
at the room trust boundary; M2M100 only sees its base codes.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import threading
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuda_dlls
cuda_dlls.ensure()

import ctranslate2 as ct2

import language_catalog


M2M100_MODEL = "facebook/m2m100_418M"
M2M100_REVISION = "55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636"
M2M100_LICENSE = "MIT"
M2M100_ARTIFACT_SHA256 = {
    "pytorch_model.bin": "d907ea45e4e4b9db163382a6674f6218b3c59566fe06d77f4055c208b4e87ed1",
    "sentencepiece.bpe.model": "d8f7c76ed2a5e0822be39f0a4f95a55eb19c78f4593ce609e2edbc2aea4d380a",
}
M2M100_SNAPSHOT_FILES = (
    "config.json", "generation_config.json", "pytorch_model.bin",
    "sentencepiece.bpe.model", "special_tokens_map.json", "tokenizer_config.json",
    "vocab.json",
)
MAX_CAPTION_CHARS = 300
MAX_TARGET_LANGUAGES = 3  # a room has four people: speaker plus up to three listeners
ROOM_LANGS = tuple(language_catalog.public_catalog()["release_live_speech_languages"])
M2M100_LANGUAGES = frozenset(
    language["code"] for language in language_catalog.public_catalog()["languages"])


def can_materialize_models(remote_runtime: bool | None = None) -> bool:
    """Only the deployed Modal runtime may download or convert M2M100 artifacts.

    A local developer can read an already provisioned, hash-valid cache, but
    must not accidentally start a multi-gigabyte download/conversion simply by
    opening a room or a Linux review checkout. The Modal image is the one
    authorized materializer.
    """
    return (os.environ.get("MODAL_IS_REMOTE") == "1"
            if remote_runtime is None else remote_runtime)


def _strip(value: str) -> str:
    return value.strip()


def _split(value: str) -> list[str]:
    return value.split()


def _is_blank_token(value: str) -> bool:
    text = _strip(value)
    return len(text) >= 2 and text[0] == "[" and text[-1] == "]"


def _has_repetition_loop(value: str, min_repeats: int = 3) -> bool:
    words = _split(value)
    if len(words) < min_repeats:
        return False
    for size in range(1, 4):
        if len(words) < size * min_repeats:
            continue
        counts: dict[str, int] = {}
        for index in range(len(words) - size + 1):
            gram = " ".join(words[index:index + size])
            counts[gram] = counts.get(gram, 0) + 1
            if counts[gram] >= min_repeats:
                return True
    return False


def _levenshtein_similarity(left: str, right: str) -> float:
    if not left and not right:
        return 1.0
    width, height = len(left), len(right)
    previous = list(range(height + 1))
    for left_index in range(width):
        current = [left_index + 1] + [0] * height
        for right_index in range(height):
            cost = 0 if left[left_index] == right[right_index] else 1
            current[right_index + 1] = min(
                previous[right_index + 1] + 1,
                current[right_index] + 1,
                previous[right_index] + cost,
            )
        previous = current
    return 1.0 - previous[height] / max(width, height)


def filter_caption(previous: str, raw: str) -> tuple[str, str]:
    """The established final-caption filter; only its MT implementation changed."""
    text = _strip(raw)
    if not text:
        return "", "empty"
    if _is_blank_token(text):
        return "", "blank_token"
    if len(text) > 200:
        return "", "runaway_length"
    if _has_repetition_loop(text):
        return "", "repetition_loop"
    if previous and _levenshtein_similarity(previous, text) >= 0.8:
        return "", "duplicate_of_prev"
    return text, "ok"


def filter_partial(raw: str) -> tuple[str, str]:
    """Partial captions retain the existing no-dedup behavior."""
    text = _strip(raw)
    if not text:
        return "", "empty"
    if _is_blank_token(text):
        return "", "blank_token"
    if len(text) > 200:
        return "", "runaway_length"
    if _has_repetition_loop(text):
        return "", "repetition_loop"
    return text, "ok"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _device() -> tuple[str, str]:
    """The certified disk/runtime profile: GPU int8_float16 or CPU int8."""
    try:
        if ct2.get_cuda_device_count() > 0:
            return "cuda", "int8_float16"
    except Exception as error:  # a driver problem fails to the explicit CPU profile
        print(f"[mt] CUDA probe failed ({type(error).__name__}); using CPU", flush=True)
    return "cpu", "int8"


class M2M100CT2:
    """One M2M100 model behind a small multi-target translation interface."""

    def __init__(
        self,
        *,
        model_root: Path | None = None,
        tokenizer: Any | None = None,
        translator: Any | None = None,
    ) -> None:
        self._root = model_root or Path(
            os.environ.get("LANG_ROOM_MODEL_ROOT") or Path.home() / ".cache" / "wa-translator")
        self._tokenizer = tokenizer
        self._translator = translator
        self._previous: dict[str, str] = {}
        self._lock = threading.RLock()
        self._started = tokenizer is not None and translator is not None
        self._device: str | None = None
        self._compute_type: str | None = None

    @property
    def started(self) -> bool:
        return self._started

    def _snapshot_dir(self) -> Path:
        return self._root / "mt-source" / f"m2m100-418m-{M2M100_REVISION[:12]}"

    def _converted_dir(self) -> Path:
        return self._root / "mt-models" / f"m2m100-418m-{M2M100_REVISION[:12]}-int8"

    def _validate_snapshot(self, snapshot: Path) -> None:
        for filename, expected in M2M100_ARTIFACT_SHA256.items():
            path = snapshot / filename
            if not path.is_file() or _sha256(path) != expected:
                raise RuntimeError(f"M2M100 pinned artifact check failed: {filename}")
        missing = [name for name in M2M100_SNAPSHOT_FILES if not (snapshot / name).is_file()]
        if missing:
            raise RuntimeError(f"M2M100 snapshot missing required files: {', '.join(missing)}")

    def _snapshot(self) -> Path:
        snapshot = self._snapshot_dir()
        try:
            self._validate_snapshot(snapshot)
            return snapshot
        except RuntimeError:
            if not can_materialize_models():
                raise RuntimeError(
                    "M2M100 source artifacts are not provisioned; the local adapter never "
                    "downloads the production model lane")
            # A partial or stale cache must never look valid.  The targeted
            # directory is entirely ours, so replacing it is recoverable.
            if snapshot.exists():
                shutil.rmtree(snapshot)
        from huggingface_hub import snapshot_download

        snapshot.parent.mkdir(parents=True, exist_ok=True)
        downloaded = Path(snapshot_download(
            M2M100_MODEL,
            revision=M2M100_REVISION,
            local_dir=str(snapshot),
            allow_patterns=list(M2M100_SNAPSHOT_FILES),
        ))
        self._validate_snapshot(downloaded)
        return downloaded

    def _converted(self, snapshot: Path) -> Path:
        converted = self._converted_dir()
        manifest = converted / "manifest.json"
        if manifest.is_file() and any(converted.glob("*.bin")):
            try:
                record = json.loads(manifest.read_text(encoding="utf-8"))
                if (record.get("model") == M2M100_MODEL
                        and record.get("revision") == M2M100_REVISION
                        and record.get("quantization") == "int8"):
                    return converted
            except json.JSONDecodeError:
                pass
        if not can_materialize_models():
            raise RuntimeError(
                "M2M100 converted artifacts are not provisioned; the local adapter never "
                "converts the production model lane")
        if converted.exists():
            shutil.rmtree(converted)
        temporary = converted.with_name(f"{converted.name}.building")
        if temporary.exists():
            shutil.rmtree(temporary)
        temporary.parent.mkdir(parents=True, exist_ok=True)
        from ctranslate2.converters import TransformersConverter

        # The converter reads only the already revision-pinned local snapshot;
        # it cannot mix mutable Hub config/tokenizer data into the artifact.
        TransformersConverter(str(snapshot)).convert(
            str(temporary), force=True, quantization="int8")
        generated = {
            path.name: _sha256(path)
            for path in sorted(temporary.rglob("*")) if path.is_file()
        }
        (temporary / "manifest.json").write_text(json.dumps({
            "model": M2M100_MODEL,
            "revision": M2M100_REVISION,
            "license": M2M100_LICENSE,
            "quantization": "int8",
            "source": {name: _sha256(snapshot / name) for name in M2M100_SNAPSHOT_FILES},
            "generated": generated,
        }, sort_keys=True, indent=2), encoding="utf-8")
        temporary.replace(converted)
        return converted

    def start(self) -> None:
        if self._started:
            return
        with self._lock:
            if self._started:
                return
            snapshot = self._snapshot()
            converted = self._converted(snapshot)
            from transformers import M2M100Tokenizer

            tokenizer = M2M100Tokenizer.from_pretrained(
                str(snapshot), local_files_only=True)
            device, compute_type = _device()
            supported = ct2.get_supported_compute_types(device)
            if compute_type not in supported:
                raise RuntimeError(
                    f"M2M100 certified compute type unavailable: {device}/{compute_type}")
            translator = ct2.Translator(
                str(converted), device=device, compute_type=compute_type, intra_threads=4)
            actual = getattr(translator, "compute_type", compute_type)
            if actual != compute_type:
                raise RuntimeError(
                    f"M2M100 compute type drift: expected {compute_type}, got {actual}")
            self._tokenizer = tokenizer
            self._translator = translator
            self._device, self._compute_type = device, compute_type
            self._started = True
            print(f"[mt] M2M100 ready {device}/{compute_type} revision={M2M100_REVISION[:12]}",
                  flush=True)

    def _source_tokens(self, text: str, source: str) -> list[str]:
        assert self._tokenizer is not None
        self._tokenizer.src_lang = source
        encoded = self._tokenizer(text, return_tensors="pt")["input_ids"]
        if hasattr(encoded, "tolist"):
            encoded = encoded.tolist()
        if encoded and isinstance(encoded[0], (list, tuple)):
            encoded = encoded[0]
        return list(self._tokenizer.convert_ids_to_tokens(encoded))

    def _target_token(self, target: str) -> str:
        assert self._tokenizer is not None
        tokens = getattr(self._tokenizer, "lang_code_to_token", {})
        token = tokens.get(target) if isinstance(tokens, dict) else None
        if not token and hasattr(self._tokenizer, "get_lang_token"):
            token = self._tokenizer.get_lang_token(target)
        if not isinstance(token, str):
            raise RuntimeError(f"M2M100 tokenizer has no target token for {target}")
        return token

    def _decode(self, tokens: list[str]) -> str:
        assert self._tokenizer is not None
        if hasattr(self._tokenizer, "convert_tokens_to_string"):
            return str(self._tokenizer.convert_tokens_to_string(tokens)).strip()
        ids = self._tokenizer.convert_tokens_to_ids(tokens)
        return str(self._tokenizer.decode(ids, skip_special_tokens=True)).strip()

    def translate_many(
        self,
        text: str,
        source: str,
        targets: Iterable[str],
        stream_id: str = "default",
        final: bool = True,
    ) -> tuple[dict[str, str], str]:
        """Translate once to each unique target; returns bounded output by code."""
        if source not in M2M100_LANGUAGES:
            return {}, "unsupported_source_language"
        unique_targets = list(dict.fromkeys(targets))
        if (not unique_targets or len(unique_targets) > MAX_TARGET_LANGUAGES
                or any(target not in M2M100_LANGUAGES for target in unique_targets)):
            return {}, "unsupported_target_language"
        filtered, reason = (filter_caption(self._previous.get(stream_id, ""), text)
                            if final else filter_partial(text))
        if not filtered:
            return {}, reason
        if final:
            self._previous[stream_id] = filtered
        result = {target: filtered for target in unique_targets if target == source}
        translated_targets = [target for target in unique_targets if target != source]
        if not translated_targets:
            return result, "same_language"
        self.start()
        assert self._translator is not None
        with self._lock:
            source_tokens = self._source_tokens(filtered, source)
            prefixes = [[self._target_token(target)] for target in translated_targets]
            outputs = self._translator.translate_batch(
                [source_tokens] * len(translated_targets),
                target_prefix=prefixes,
                beam_size=1,
                max_decoding_length=MAX_CAPTION_CHARS,
            )
            for target, prefix, output in zip(translated_targets, prefixes, outputs):
                hypothesis = list(output.hypotheses[0]) if output.hypotheses else []
                if hypothesis and hypothesis[0] == prefix[0]:
                    hypothesis = hypothesis[1:]
                decoded = self._decode(hypothesis)[:MAX_CAPTION_CHARS]
                if decoded:
                    result[target] = decoded
        return result, "ok"


_engine: M2M100CT2 | None = None
_engine_lock = threading.Lock()


def get_engine() -> M2M100CT2:
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = M2M100CT2()
        return _engine


def translate_many(
    text: str, source: str, targets: Iterable[str], stream_id: str = "default", final: bool = True,
) -> tuple[dict[str, str], str]:
    return get_engine().translate_many(text, source, targets, stream_id, final)


def translate(text: str, direction: str, stream_id: str = "default", final: bool = True) -> tuple[str, str]:
    """Compatibility wrapper retained for older local callers and fixtures."""
    source, separator, target = direction.partition("-")
    if not separator or not source or not target:
        return "", "unsupported_target_language"
    translated, reason = translate_many(text, source, [target], stream_id, final)
    return translated.get(target, ""), reason


def preload() -> None:
    """Load exactly one M2M100 runtime; it does not multiply by language pair."""
    get_engine().start()


def model_receipt() -> dict[str, object]:
    engine = get_engine()
    return {
        "model": M2M100_MODEL,
        "revision": M2M100_REVISION,
        "license": M2M100_LICENSE,
        "ready": engine.started,
        "max_targets": MAX_TARGET_LANGUAGES,
    }

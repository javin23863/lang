#!/usr/bin/env python3
"""mt_ct2.py — CTranslate2 int8 OPUS-MT translation (Windows MT layer).

Gate 1b benchmarked CTranslate2 int8 OPUS-MT: en-zh 47ms, en-de 248ms pass;
en-es 648ms+ fail (loops). This module wraps that for live use.

The caption filter (shared C++ logic, ported to Python) runs on ASR output
before MT: loop detector, blank-token, dedup, length cap. This prevents
the repetition loops that Gate 1b found in raw ASR output.

Usage:
    mt = CTranslate2MT(pair="en-zh")
    mt.start()
    translated = mt.translate("Hello world")
    mt.stop()
"""

import os
import threading
import sentencepiece as spm
import ctranslate2 as ct2

# Caption filter — Python port of caption_filter.h (same logic, same tests)
def _strip(s):
    return s.strip()

def _split(s):
    return s.split()

def _is_blank_token(s):
    t = _strip(s)
    return len(t) >= 2 and t[0] == '[' and t[-1] == ']'

def _has_repetition_loop(s, min_repeats=3):
    words = _split(s)
    if len(words) < min_repeats:
        return False
    for n in range(1, 4):
        if len(words) < n * min_repeats:
            continue
        counts = {}
        for i in range(len(words) - n + 1):
            g = ' '.join(words[i:i+n])
            counts[g] = counts.get(g, 0) + 1
            if counts[g] >= min_repeats:
                return True
    return False

def _levenshtein(a, b):
    if not a and not b:
        return 1.0
    m, n = len(a), len(b)
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            cost = 0 if a[i-1] == b[j-1] else 1
            cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
        prev = cur
    return 1.0 - prev[n] / max(m, n)

def filter_caption(prev, raw):
    """Returns (text, reason). text is empty if suppressed."""
    t = _strip(raw)
    if not t:
        return "", "empty"
    if _is_blank_token(t):
        return "", "blank_token"
    if len(t) > 200:
        return "", "runaway_length"
    if _has_repetition_loop(t):
        return "", "repetition_loop"
    if prev and _levenshtein(prev, t) >= 0.8:
        return "", "duplicate_of_prev"
    return t, "ok"


# OPUS-MT model IDs per pair (HuggingFace Helsinki-NLP)
PAIRS = {
    "en-zh": "Helsinki-NLP/opus-mt-en-zh",
    "en-de": "Helsinki-NLP/opus-mt-en-de",
    "en-es": "Helsinki-NLP/opus-mt-en-es",
    "en-fr": "Helsinki-NLP/opus-mt-en-fr",
    "en-ru": "Helsinki-NLP/opus-mt-en-ru",
    "en-ja": "Helsinki-NLP/opus-mt-en-ja",
}

# Per-pair status from Gate 1b benchmark
PAIR_STATUS = {
    "en-zh": ("fast", "47ms avg, PASS"),
    "en-de": ("fast", "248ms avg, PASS"),
    "en-es": ("slow", "648ms+ avg, loops — may need Apple Translation on iPhone"),
    "en-fr": ("untested", "not benchmarked yet"),
    "en-ru": ("untested", "not benchmarked yet"),
    "en-ja": ("untested", "not benchmarked yet"),
}


class CTranslate2MT:
    """CTranslate2 int8 OPUS-MT translator with caption filter.

    Maintains separate dedup state per stream (host vs guest) so the same
    phrase spoken by two different people isn't filtered as a duplicate.
    """

    def __init__(self, pair="en-zh", model_dir=None):
        self.pair = pair
        self._model_dir = model_dir
        self._translator = None
        self._sp_src = None
        self._sp_tgt = None
        self._prev_text = {}  # stream_id -> previous text (per-stream dedup)
        self._lock = threading.Lock()
        self._started = False

    def _resolve_model_dir(self):
        """Find or download+convert the CTranslate2 int8 model."""
        from pathlib import Path
        if self._model_dir and os.path.isdir(self._model_dir):
            return self._model_dir
        # Default cache location
        cache = Path.home() / ".cache" / "wa-translator" / "mt_models" / f"ct2-{self.pair}-int8"
        if cache.exists() and any(f.endswith(".bin") for f in os.listdir(cache)):
            return str(cache)
        # Download + convert
        return self._download_and_convert(str(cache))

    def _download_and_convert(self, out_dir):
        hf_id = PAIRS[self.pair]
        os.makedirs(out_dir, exist_ok=True)
        print(f"[mt] downloading {hf_id} and converting to CT2 int8...")
        from huggingface_hub import snapshot_download
        src = snapshot_download(hf_id)
        from ctranslate2.converters import TransformersConverter
        conv = TransformersConverter(hf_id)
        conv.convert(out_dir, force=True, quantization="int8")
        # Copy sentencepiece files
        import shutil
        for f in ("source.spm", "target.spm"):
            s = os.path.join(src, f)
            d = os.path.join(out_dir, f)
            if os.path.exists(s) and not os.path.exists(d):
                shutil.copy(s, d)
        return out_dir

    def start(self):
        d = self._resolve_model_dir()
        self._sp_src = spm.SentencePieceProcessor(
            model_file=os.path.join(d, "source.spm"))
        self._sp_tgt = spm.SentencePieceProcessor(
            model_file=os.path.join(d, "target.spm"))
        self._translator = ct2.Translator(d, compute_type="int8", intra_threads=4)
        # Warmup
        dummy = self._sp_src.encode("hello")
        dummy = [self._sp_src.id_to_piece([x]) for x in dummy]
        self._translator.translate_batch([dummy], beam_size=1)
        self._started = True
        print(f"[mt] CTranslate2 started ({self.pair}, int8)")

    def translate(self, text, stream_id="default"):
        """Filter, then translate. Returns (translated_text, reason).

        Uses per-stream dedup state so the same phrase spoken by two
        different people isn't filtered as a duplicate.
        """
        if not self._started:
            return "", "not_started"
        prev = self._prev_text.get(stream_id, "")
        filtered, reason = filter_caption(prev, text)
        if not filtered:
            return "", reason
        self._prev_text[stream_id] = filtered
        with self._lock:
            tokens = self._sp_src.encode(filtered)
            tokens = [self._sp_src.id_to_piece([x]) for x in tokens]
            results = self._translator.translate_batch([tokens], beam_size=1)
            out_ids = [self._sp_tgt.piece_to_id(t) for t in results[0].hypotheses[0]]
            out_text = self._sp_tgt.decode(out_ids)
        return out_text, "ok"

    def stop(self):
        self._started = False
        # CTranslate2 translator doesn't need explicit stop
        print("[mt] CTranslate2 stopped")
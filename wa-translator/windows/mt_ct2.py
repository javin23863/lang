#!/usr/bin/env python3
"""mt_ct2.py — CTranslate2 OPUS-MT translation, both directions, GPU when present.

The room is bilingual: every participant declares the language they speak, and
each utterance is translated into the *other* participant's language. So the
module holds a registry of directional engines (en-es, es-en, ...) built lazily
on first use, not one global pair.

The caption filter (shared C++ logic, ported to Python) runs on ASR output
before MT: loop detector, blank-token, dedup, length cap. This prevents the
repetition loops that Gate 1b found in raw ASR output. Partial captions get
filter_partial() instead — the dedup rule would swallow every one of them,
since a partial is by construction nearly identical to its predecessor.

Usage:
    translated, reason = translate("Hello world", "en-es", stream_id="3")
"""

import os
import threading
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuda_dlls
cuda_dlls.ensure()

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


def filter_partial(raw):
    """filter_caption minus the dedup rule, for in-flight partial captions.

    A partial is meant to look like the one before it — it is the same sentence
    with another word on the end. Running duplicate_of_prev over partials would
    suppress the entire live caption stream.
    """
    t = _strip(raw)
    if not t:
        return "", "empty"
    if _is_blank_token(t):
        return "", "blank_token"
    if len(t) > 200:
        return "", "runaway_length"
    if _has_repetition_loop(t):
        return "", "repetition_loop"
    return t, "ok"


# OPUS-MT model IDs per direction (HuggingFace Helsinki-NLP).
# en-es uses the tc-big model: it is a generation newer than the small
# opus-mt-en-es and markedly better on conversational Spanish. There is no
# tc-big for es-en (the repo 404s), so that direction keeps the small model.
PAIRS = {
    "en-es": "Helsinki-NLP/opus-mt-tc-big-en-es",
    "es-en": "Helsinki-NLP/opus-mt-es-en",
    "en-zh": "Helsinki-NLP/opus-mt-en-zh",
    "en-de": "Helsinki-NLP/opus-mt-en-de",
    "en-fr": "Helsinki-NLP/opus-mt-en-fr",
    "en-ru": "Helsinki-NLP/opus-mt-en-ru",
    "en-ja": "Helsinki-NLP/opus-mt-en-ja",
}

# Languages the room offers. Both directions between any two must exist above.
ROOM_LANGS = ("en", "es")

# Gate 1b's per-pair latency table used to live here. Its numbers were measured
# before the encode_as_pieces fix and before the missing </s> was found, so they
# described neither this code nor the models — and nothing read them except the
# retired tkinter host. probe_stream.py measures the pairs that are actually in
# use; a table of stale numbers is worse than no table.


def _device():
    """('cuda', 'int8_float16') when a GPU is visible, else ('cpu', 'int8')."""
    try:
        if ct2.get_cuda_device_count() > 0:
            return "cuda", "int8_float16"
    except Exception as e:  # noqa: BLE001 - a driver problem just means CPU
        print(f"[mt] CUDA probe failed ({e}); using CPU")
    return "cpu", "int8"


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
        from huggingface_hub import hf_hub_download
        from ctranslate2.converters import TransformersConverter
        conv = TransformersConverter(hf_id)
        conv.convert(out_dir, force=True, quantization="int8")
        # The sentencepiece models are not part of the CT2 conversion output.
        # Fetch just those two files — a snapshot_download here would also drag
        # down tf_model.h5 and the benchmark archives for nothing.
        import shutil
        for f in ("source.spm", "target.spm"):
            d = os.path.join(out_dir, f)
            if not os.path.exists(d):
                shutil.copy(hf_hub_download(hf_id, f), d)
        return out_dir

    def start(self):
        d = self._resolve_model_dir()
        self._sp_src = spm.SentencePieceProcessor(
            model_file=os.path.join(d, "source.spm"))
        self._sp_tgt = spm.SentencePieceProcessor(
            model_file=os.path.join(d, "target.spm"))
        device, compute_type = _device()
        self._translator = ct2.Translator(
            d, device=device, compute_type=compute_type, intra_threads=4)
        # Warmup — translate_batch expects List[List[str]] (string tokens)
        dummy_tokens = self._sp_src.encode_as_pieces("hello")
        self._translator.translate_batch([dummy_tokens], beam_size=1)
        self._started = True
        print(f"[mt] CTranslate2 started ({self.pair}, {device}/{compute_type})")

    def translate(self, text, stream_id="default", final=True):
        """Filter, then translate. Returns (translated_text, reason).

        Uses per-stream dedup state so the same phrase spoken by two
        different people isn't filtered as a duplicate. Partials skip the dedup
        rule and do not advance that state — only what the reader keeps counts
        as "what was said before".
        """
        if not self._started:
            return "", "not_started"
        if final:
            prev = self._prev_text.get(stream_id, "")
            filtered, reason = filter_caption(prev, text)
        else:
            filtered, reason = filter_partial(text)
        if not filtered:
            return "", reason
        if final:
            self._prev_text[stream_id] = filtered
        with self._lock:
            # The trailing </s> is not optional. Marian models are trained with
            # an explicit end-of-source token; without it the decoder never sees
            # the sentence end and re-translates the input over and over. This
            # is what Gate 1b recorded as "en-es loops" and blamed on the model.
            tokens = self._sp_src.encode_as_pieces(filtered) + ["</s>"]
            results = self._translator.translate_batch(
                [tokens], beam_size=1, max_decoding_length=256)
            out_text = self._sp_tgt.decode(results[0].hypotheses[0])
        return out_text, "ok"

    def stop(self):
        self._started = False
        # CTranslate2 translator doesn't need explicit stop
        print("[mt] CTranslate2 stopped")


# ── Directional engine registry ───────────────────────────────────────
# One engine per direction, built on first use. Two participants speaking
# different languages need both directions live at once, which the old single
# global `mt_engine` could not represent.

_engines: dict[str, CTranslate2MT] = {}
_registry_lock = threading.Lock()


def get_engine(direction: str) -> CTranslate2MT:
    with _registry_lock:
        eng = _engines.get(direction)
        if eng is None:
            if direction not in PAIRS:
                raise KeyError(f"no MT model for direction {direction!r}")
            eng = CTranslate2MT(pair=direction)
            eng.start()
            _engines[direction] = eng
        return eng


def translate(text: str, direction: str, stream_id: str = "default", final: bool = True):
    """Translate one caption. Returns (translated_text, reason)."""
    if not direction or direction.split("-")[0] == direction.split("-")[-1]:
        return text, "same_language"
    return get_engine(direction).translate(text, stream_id=stream_id, final=final)


def preload(directions=None):
    """Build engines up front so the first spoken sentence isn't slow."""
    for d in directions or [f"{a}-{b}" for a in ROOM_LANGS for b in ROOM_LANGS if a != b]:
        get_engine(d)


def _demo():
    preload()
    for direction, text in (("en-es", "Where is the train station?"),
                            ("es-en", "¿Dónde está la estación de tren?")):
        out, reason = translate(text, direction, stream_id="demo")
        assert reason == "ok" and out, f"{direction} returned {out!r} ({reason})"
        assert out.lower() != text.lower(), f"{direction} echoed the input back"
        # A missing </s> on the source produces fluent output that repeats the
        # sentence forever, so "it returned different words" is not enough of a
        # check — the length and the loop detector are what actually fail on it.
        assert not _has_repetition_loop(out), f"{direction} looped: {out[:120]!r}"
        assert len(out) < 3 * len(text) + 30, \
            f"{direction} output {len(out)} chars from {len(text)}: {out[:120]!r}"
        print(f"  {direction}: {text!r} -> {out!r}")

    # A partial repeated verbatim must survive; a final must not.
    assert translate("hello there", "en-es", "s", final=False)[1] == "ok"
    assert translate("hello there", "en-es", "s", final=False)[1] == "ok", \
        "dedup leaked into the partial path"
    assert translate("hello there", "en-es", "s", final=True)[1] == "ok"
    assert translate("hello there", "en-es", "s", final=True)[1] == "duplicate_of_prev"

    # Same language in and out is a passthrough, not a model load.
    assert translate("no change", "en-en")[1] == "same_language"
    print("mt_ct2 self-check PASS")


if __name__ == "__main__":
    _demo()
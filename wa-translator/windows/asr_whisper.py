#!/usr/bin/env python3
"""asr_whisper.py — faster-whisper large-v3-turbo ASR for the live room.

One model instance handles every speaker and both languages. The language is
always passed explicitly (never auto-detected): detection on a 300ms partial is
a coin flip, and a wrong guess mid-utterance produces gibberish that the caption
filter cannot recover from.

    asr = WhisperASR()
    text = asr.transcribe(pcm_float32_16k, lang="es", partial=True)

Replaces moonshine_asr.py: Moonshine only ships a non-streaming BASE model for
Spanish, and this room is bilingual by definition.
"""

import os
import sys
import threading
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuda_dlls
cuda_dlls.ensure()
from endpointer import has_speech

MODEL = "large-v3-turbo"
SAMPLE_RATE = 16000

# Whisper invents training-set filler on short audio — the Spanish model returns
# "Gracias." for ~0.6s of speech, and reports no_speech_prob=0.0 with a healthy
# avg_logprob while doing it. Its own confidence scores therefore cannot be used
# to catch this; a logprob gate here was tried and measurably caught nothing.
# What does work: the Silero gate below, plus never asking for a decode under
# MIN_PARTIAL_S seconds of speech (see translation_server).
MIN_DECODE_S = 0.1


def _pick_device():
    """(device, compute_type) — CUDA when CTranslate2 can see a GPU, else CPU."""
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception as e:  # noqa: BLE001 - any CT2 import/driver problem means CPU
        print(f"[asr] CUDA probe failed ({e}); using CPU")
    return "cpu", "int8"


class WhisperASR:
    def __init__(self, model=MODEL, device=None, compute_type=None):
        from faster_whisper import WhisperModel

        if device is None:
            device, compute_type = _pick_device()
        self.device = device
        self.compute_type = compute_type
        t0 = time.perf_counter()
        self.model = WhisperModel(model, device=device, compute_type=compute_type)
        self._lock = threading.Lock()
        print(f"[asr] {model} loaded on {device}/{compute_type} "
              f"in {time.perf_counter() - t0:.1f}s")

    def transcribe(self, pcm: np.ndarray, lang: str, partial: bool = False) -> str:
        """Transcribe one utterance-so-far. Returns text ('' when nothing heard).

        partial=True trades accuracy for latency: greedy decode, no fallback
        temperatures. Finals get a beam search because they are what the other
        person actually reads.
        """
        if pcm.dtype != np.float32:
            pcm = pcm.astype(np.float32)
        if len(pcm) < SAMPLE_RATE * MIN_DECODE_S:
            return ""
        # Whisper invents text when handed silence. Gate every call, not just
        # the ones the server thinks are risky.
        if not has_speech(pcm):
            return ""

        with self._lock:
            segments, _info = self.model.transcribe(
                pcm,
                language=lang,
                beam_size=1 if partial else 5,
                temperature=0.0 if partial else [0.0, 0.2, 0.4],
                # Each utterance is decoded from scratch. Conditioning on the
                # previous text makes whisper repeat the last caption when the
                # new audio is short or noisy.
                condition_on_previous_text=False,
                without_timestamps=True,
                # Upstream endpointing already guarantees speech in the buffer;
                # re-running VAD here would trim the leading word of a partial.
                vad_filter=False,
            )
            return " ".join(s.text for s in segments).strip()


def _demo():
    """Self-check: silence must transcribe to nothing, speech must not."""
    asr = WhisperASR()

    silence = np.zeros(SAMPLE_RATE * 2, dtype=np.float32)
    assert asr.transcribe(silence, "en") == "", "silence produced a hallucination"

    hiss = (np.random.randn(SAMPLE_RATE * 2) * 0.05).astype(np.float32)
    assert asr.transcribe(hiss, "es") == "", "noise produced a hallucination"

    too_short = np.random.randn(800).astype(np.float32) * 0.01
    assert asr.transcribe(too_short, "en") == "", "sub-100ms audio was decoded"

    # Regression, and the reason MIN_PARTIAL_S exists: 0.6s of the Spanish
    # fixture decodes to "Gracias." — confidently. The Silero gate is what stops
    # it here; disable has_speech() and this assertion fails, which is the point.
    fixture = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "test-audio", "es.wav")
    if os.path.exists(fixture):
        import wave
        with wave.open(fixture, "rb") as w:
            clip = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        clip = clip.astype(np.float32) / 32768.0
        assert asr.transcribe(clip[:int(SAMPLE_RATE * 0.6)], "es", partial=True) == "", \
            "sub-second slice was decoded — the filler it returns reaches the reader"
        # Past the gate, the same clip must produce real words, or the gate is
        # simply refusing everything.
        assert "dónde" in asr.transcribe(clip[:int(SAMPLE_RATE * 1.2)], "es",
                                         partial=True).lower()

    if len(sys.argv) > 1:
        import wave
        with wave.open(sys.argv[1], "rb") as w:
            assert w.getframerate() == SAMPLE_RATE, f"need 16k wav, got {w.getframerate()}"
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        pcm = (pcm.astype(np.float32) / 32768.0)
        lang = sys.argv[2] if len(sys.argv) > 2 else "en"
        for mode in (True, False):
            t0 = time.perf_counter()
            text = asr.transcribe(pcm, lang, partial=mode)
            dt = (time.perf_counter() - t0) * 1000
            print(f"[{'partial' if mode else 'final  '}] {dt:6.0f}ms  {text}")
    print("asr_whisper self-check PASS")


if __name__ == "__main__":
    _demo()

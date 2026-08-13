#!/usr/bin/env python3
"""endpointer.py — Silero VAD speech detection and utterance endpointing.

Two jobs:

  has_speech(pcm)      gate — is there any speech in this buffer at all?
  Endpointer.feed()    endpointing — is the speaker still talking, and how long
                       have they been quiet?

The Silero model ships inside faster-whisper (assets/silero_vad_v6.onnx), so
this costs no extra dependency. It replaces the fixed RMS threshold of 0.01 the
old server used, which never fired on a quiet mic and fired constantly on a
noisy one.
"""

import numpy as np

SAMPLE_RATE = 16000
WINDOW = 512               # silero's frame size: 32ms at 16kHz
LOOKBACK = WINDOW * 32     # ~1.02s of history is enough to judge a 500ms pause
SPEECH_THRESHOLD = 0.5
SILENCE_THRESHOLD = 0.35   # hysteresis: below this is definitely silence
LEAD_PAD = 3200            # 200ms kept before the first speech window
WINDOW_MS = WINDOW / SAMPLE_RATE * 1000


def prime_vad_import() -> None:
    """Finish the shared faster-whisper VAD import without loading its model."""
    from faster_whisper.vad import get_vad_model  # noqa: F401


def speech_probs(pcm: np.ndarray) -> np.ndarray:
    """Per-32ms speech probability. Trailing partial window is dropped."""
    from faster_whisper.vad import get_vad_model

    n = (len(pcm) // WINDOW) * WINDOW
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    out = get_vad_model()(np.ascontiguousarray(pcm[:n], dtype=np.float32))
    return np.asarray(out).reshape(-1)


def has_speech(pcm: np.ndarray, threshold: float = SPEECH_THRESHOLD) -> bool:
    """True when any 32ms window looks like speech."""
    probs = speech_probs(pcm)
    return bool(probs.size and probs.max() >= threshold)


class Endpointer:
    """Tracks one speaker's utterance: has it started, how much of it is speech,
    and has it ended.

    Feed 16kHz float32 frames as they arrive. The endpointer only inspects the
    most recent ~1s, so cost is constant no matter how long the utterance runs.

    speech_ms is deliberately not the buffer length. The buffer also holds
    however much silence preceded the first word, and gating a decode on buffer
    length lets whisper see a sliver of speech padded with quiet — which is
    exactly the input it answers with invented filler.
    """

    def __init__(self):
        self.buf = np.zeros(0, dtype=np.float32)
        self.speech_seen = False
        self.speech_start = 0   # index into buf where the utterance begins

    def feed(self, frame: np.ndarray):
        """Append a frame. Returns (speech_seen, trailing_silence_ms)."""
        self.buf = np.concatenate([self.buf, frame.astype(np.float32)])
        base = max(0, len(self.buf) - LOOKBACK)
        probs = speech_probs(self.buf[base:])
        if probs.size == 0:
            return self.speech_seen, 0.0

        hits = np.nonzero(probs >= SPEECH_THRESHOLD)[0]
        if hits.size and not self.speech_seen:
            self.speech_seen = True
            # Keep a little room before the first speech window: Silero marks
            # the window it is sure about, which is usually just after the word
            # actually started, and a clipped first syllable costs a word.
            self.speech_start = max(0, base + int(hits[0]) * WINDOW - LEAD_PAD)

        silent = 0
        for p in probs[::-1]:
            if p >= SILENCE_THRESHOLD:
                break
            silent += 1
        return self.speech_seen, silent * WINDOW_MS

    @property
    def duration_ms(self) -> float:
        """Everything buffered, silence included."""
        return len(self.buf) / SAMPLE_RATE * 1000

    @property
    def speech_ms(self) -> float:
        """Length of the utterance itself, from its first word."""
        if not self.speech_seen:
            return 0.0
        return (len(self.buf) - self.speech_start) / SAMPLE_RATE * 1000

    def pending(self) -> np.ndarray:
        """The utterance so far, leading silence trimmed off."""
        return self.buf[self.speech_start:].copy()

    def take(self) -> np.ndarray:
        """Return the utterance and reset for the next one."""
        audio = self.buf[self.speech_start:] if self.speech_seen else self.buf
        self.buf = np.zeros(0, dtype=np.float32)
        self.speech_seen = False
        self.speech_start = 0
        return audio


def _tone(ms, freq=220, sr=SAMPLE_RATE):
    """Not speech, but loud — proves the gate rejects on content, not volume."""
    t = np.arange(int(sr * ms / 1000)) / sr
    return (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _demo():
    silence = np.zeros(SAMPLE_RATE, dtype=np.float32)
    assert not has_speech(silence), "digital silence read as speech"
    assert not has_speech(_tone(1000)), "a pure tone read as speech"
    assert not has_speech(np.zeros(100, dtype=np.float32)), "sub-window buffer crashed"

    ep = Endpointer()
    for _ in range(10):
        seen, silent_ms = ep.feed(np.zeros(1600, dtype=np.float32))
    assert not seen, "silence started an utterance"
    assert silent_ms >= 500, f"1s of silence reported as {silent_ms}ms"
    assert abs(ep.duration_ms - 1000) < 1, ep.duration_ms
    assert len(ep.take()) == SAMPLE_RATE and ep.duration_ms == 0
    print("endpointer self-check PASS")


if __name__ == "__main__":
    _demo()

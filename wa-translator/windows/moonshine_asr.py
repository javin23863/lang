#!/usr/bin/env python3
"""
moonshine_asr.py — Moonshine ASR helper (Windows).

Wraps the moonshine-voice pip package. Uses get_model_for_language() for
correct cross-platform model path resolution (not a hardcoded Linux path).

In the v6 architecture, ASR runs inside translation_server.py using the
batch method transcribe_without_streaming() on accumulated audio chunks.
This module provides the helper functions for that.
"""

import time
import numpy as np

try:
    from moonshine_voice import Transcriber
    from moonshine_voice.download import get_model_for_language
    from moonshine_voice.moonshine_api import ModelArch
    MOONSHINE_AVAILABLE = True
except ImportError:
    MOONSHINE_AVAILABLE = False
    Transcriber = None

_transcriber = None
_model_path = None

def get_transcriber():
    """Lazy-load the Moonshine transcriber (singleton)."""
    global _transcriber, _model_path
    if _transcriber is not None:
        return _transcriber
    if not MOONSHINE_AVAILABLE:
        raise RuntimeError("moonshine-voice not installed")
    print("[asr] loading Moonshine small-streaming model...")
    _model_path, arch = get_model_for_language('en', ModelArch.SMALL_STREAMING)
    _transcriber = Transcriber(model_path=_model_path, model_arch=arch)
    print(f"[asr] model loaded: {_model_path}")
    return _transcriber

def transcribe(audio: np.ndarray, sample_rate: int = 16000):
    """Transcribe audio (batch mode). Returns list of (start_time, text)."""
    t = get_transcriber()
    t0 = time.perf_counter()
    result = t.transcribe_without_streaming(audio, sample_rate)
    dt = (time.perf_counter() - t0) * 1000
    lines = [(line.start_time, line.text) for line in result.lines]
    return lines, dt
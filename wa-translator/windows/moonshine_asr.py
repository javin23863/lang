#!/usr/bin/env python3
"""moonshine_asr.py — Moonshine ASR streaming transcription (Windows).

Moonshine small-streaming is the v5 primary ASR (123M, MIT for English).
One Transcriber, multiple Streams — the library-level solution to the
v2/v3 two-stream serialization problem. Built-in VAD + diarization.

This module wraps the moonshine-voice pip package for the Windows desktop
translator. Same ONNX models, same API as the Linux benchmark.

Per Gate 1c findings: honest per-line latency is 2-4s on CPU (not the 269ms
marketing number). The overlay shows "translating..." while in flight.

Usage:
    asr = MoonshineASR()
    asr.start(on_remote_line=lambda text: ..., on_local_line=lambda text: ...)
    # audio_capture feeds chunks via asr.feed_remote(pcm) / asr.feed_local(pcm)
    asr.stop()
"""

import threading
import time
import numpy as np

try:
    from moonshine_voice import Transcriber, TranscriptEventListener
    from moonshine_voice.moonshine_api import ModelArch
    MOONSHINE_AVAILABLE = True
except ImportError:
    MOONSHINE_AVAILABLE = False
    print("[asr] moonshine-voice not installed; ASR will be in mock mode")


class _LineListener(TranscriptEventListener):
    """Collects completed lines and fires a callback."""

    def __init__(self, tag, callback):
        self.tag = tag
        self.callback = callback
        self.lines = []
        self.lats = []
        self._last_t = 0.0

    def on_line_completed(self, event):
        now = time.perf_counter()
        if self._last_t:
            self.lats.append((now - self._last_t) * 1000)
        self._last_t = now
        text = event.line.text.strip()
        start = event.line.start_time
        self.lines.append((start, text))
        if self.callback and text:
            latency = self.lats[-1] if self.lats else 0
            self.callback(text, start, latency)


class MoonshineASR:
    """Two-stream Moonshine ASR: one transcriber, two streams (local+remote)."""

    def __init__(self, model_path=None, model_arch=None):
        self._lock = threading.Lock()
        self._transcriber = None
        self._stream_remote = None
        self._stream_local = None
        self._listener_remote = None
        self._listener_local = None
        self._model_path = model_path
        self._model_arch = model_arch
        self._started = False

    def start(self, on_remote_line=None, on_local_line=None):
        """Initialize Moonshine and start both streams."""
        if not MOONSHINE_AVAILABLE:
            print("[asr] WARNING: moonshine-voice not available, running in mock mode")
            return

        # Auto-download / locate model if not specified
        if self._model_path is None:
            self._model_path = self._find_or_download_model()

        if self._model_arch is None:
            self._model_arch = ModelArch.SMALL_STREAMING

        print(f"[asr] loading Moonshine model: {self._model_path}")
        self._transcriber = Transcriber(
            model_path=self._model_path, model_arch=self._model_arch)
        self._transcriber.start()

        # Two streams on one transcriber (the v5 design — solves v2 serialization)
        self._stream_remote = self._transcriber.create_stream()
        self._stream_local = self._transcriber.create_stream()

        self._listener_remote = _LineListener("REMOTE", on_remote_line)
        self._listener_local = _LineListener("LOCAL", on_local_line)
        self._stream_remote.add_listener(self._listener_remote)
        self._stream_local.add_listener(self._listener_local)

        self._stream_remote.start()
        self._stream_local.start()
        self._started = True
        print("[asr] Moonshine two-stream started (small-streaming, ONNX CPU)")

    def _find_or_download_model(self):
        """Locate cached Moonshine model or trigger download."""
        import os
        from pathlib import Path
        cache = Path.home() / ".cache" / "moonshine_voice"
        # Look for small-streaming-en
        model_dir = cache / "download.moonshine.ai" / "model" / "small-streaming-en" / "quantized"
        if model_dir.exists():
            return str(model_dir)
        # Trigger download via moonshine-voice's own mechanism
        print("[asr] downloading Moonshine small-streaming-en model (~250 MB)...")
        try:
            from moonshine_voice.moonshine_api import download_model
            return download_model(ModelArch.SMALL_STREAMING, quantized=True)
        except (ImportError, AttributeError):
            # Fallback: let Transcriber auto-download
            # moonshine-voice may accept None and handle it
            print("[asr] could not auto-download; Transcriber will attempt auto-download")
            return None

    def feed_remote(self, pcm, sample_rate=16000):
        """Feed remote (speaker/loopback) audio chunk to Moonshine."""
        if not self._started or self._stream_remote is None:
            return
        with self._lock:
            self._stream_remote.add_audio(pcm, sample_rate)

    def feed_local(self, pcm, sample_rate=16000):
        """Feed local (mic) audio chunk to Moonshine."""
        if not self._started or self._stream_local is None:
            return
        with self._lock:
            self._stream_local.add_audio(pcm, sample_rate)

    def stop(self):
        if not self._started:
            return
        try:
            self._stream_remote.stop()
        except Exception:
            pass
        try:
            self._stream_local.stop()
        except Exception:
            pass
        try:
            self._transcriber.stop()
        except Exception:
            pass
        self._started = False
        print("[asr] Moonshine stopped")

    def stats(self):
        return {
            "remote_lines": len(self._listener_remote.lines) if self._listener_remote else 0,
            "local_lines": len(self._listener_local.lines) if self._listener_local else 0,
            "remote_lats": self._listener_remote.lats if self._listener_remote else [],
            "local_lats": self._listener_local.lats if self._listener_local else [],
        }
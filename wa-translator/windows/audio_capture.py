#!/usr/bin/env python3
"""audio_capture.py — Windows two-stream audio capture.

Capture two audio streams simultaneously:
  - remote: WASAPI loopback of the default speaker (WhatsApp call's remote party)
  - local:  default microphone (your own voice)

Both are resampled to 16 kHz mono float32 chunks and pushed to callbacks.
This is the Windows equivalent of iOS ReplayKit's .audioApp + .audioMic.

Uses the `soundcard` library which wraps WASAPI loopback (the documented,
stable Windows API for system audio capture). This is why Windows capture
is "solved" — unlike iOS Gate 2, WASAPI loopback just works.

Usage:
    cap = AudioCapture()
    cap.start(on_remote=remote_cb, on_local=local_cb)
    ...
    cap.stop()

Each callback receives (pcm_float32, num_samples, sample_rate=16000).
"""

import threading
import queue
import numpy as np
import soundcard as sc

TARGET_SR = 16000
CHUNK_SECONDS = 0.1  # 100ms chunks, matching Moonshine's streaming API design
CHUNK_SAMPLES = int(TARGET_SR * CHUNK_SECONDS)


def _resample_to_16k(data: np.ndarray, src_sr: int) -> np.ndarray:
    """Simple linear resample to 16 kHz mono."""
    if src_sr == TARGET_SR:
        return data
    # mono mix if multi-channel
    if data.ndim > 1:
        data = data.mean(axis=1)
    ratio = TARGET_SR / src_sr
    n_out = int(len(data) * ratio)
    indices = np.arange(n_out) / ratio
    indices = np.clip(indices.astype(int), 0, len(data) - 1)
    return data[indices].astype(np.float32)


class _StreamThread(threading.Thread):
    """Capture one audio stream in a background thread, push 100ms chunks."""

    def __init__(self, recorder_factory, callback, name="stream"):
        super().__init__(daemon=True, name=name)
        self.recorder_factory = recorder_factory
        self.callback = callback
        self._stop_evt = threading.Event()

    def run(self):
        try:
            recorder = self.recorder_factory()
            with recorder:
                while not self._stop_evt.is_set():
                    data = recorder.record(numframes=CHUNK_SAMPLES)
                    if data.ndim > 1:
                        data = data.mean(axis=1)
                    data = data.astype(np.float32).flatten()
                    if self.callback:
                        self.callback(data, len(data), TARGET_SR)
        except Exception as e:
            print(f"  [{self.name}] capture error: {e}")

    def stop(self):
        self._stop_evt.set()


class AudioCapture:
    """Two-stream Windows audio capture (mic + loopback)."""

    def __init__(self):
        self._remote_thread = None
        self._local_thread = None
        self._running = False

    @staticmethod
    def list_devices():
        """Print available capture devices."""
        print("Microphones (local mic):")
        for m in sc.all_microphones(include_loopback=False):
            print(f"  {m.name}")
        print("Loopback (remote speaker):")
        for m in sc.all_microphones(include_loopback=True):
            if getattr(m, "isloopback", False):
                print(f"  {m.name}")

    def _make_remote_recorder(self):
        """Find the loopback device matching the default speaker."""
        default_spk_name = sc.default_speaker().name
        mics = sc.all_microphones(include_loopback=True)
        # Prefer the one matching default speaker
        for m in mics:
            if getattr(m, "isloopback", False) and m.name == default_spk_name:
                return m.recorder(samplerate=TARGET_SR, channels=1)
        # Fallback: first available loopback
        for m in mics:
            if getattr(m, "isloopback", False):
                return m.recorder(samplerate=TARGET_SR, channels=1)
        raise RuntimeError("No WASAPI loopback device found")

    def _make_local_recorder(self):
        """Default microphone."""
        mics = sc.all_microphones(include_loopback=False)
        if not mics:
            raise RuntimeError("No microphone found")
        # Prefer Intel Smart Sound mic if present (common laptop default)
        for m in mics:
            if "Intel" in m.name or "Smart Sound" in m.name:
                return m.recorder(samplerate=TARGET_SR, channels=1)
        return mics[0].recorder(samplerate=TARGET_SR, channels=1)

    def start(self, on_remote=None, on_local=None):
        """Start both capture streams. Each callback gets (pcm_f32, n, sr)."""
        self._running = True
        self._remote_thread = _StreamThread(
            self._make_remote_recorder, on_remote, name="remote-capture")
        self._local_thread = _StreamThread(
            self._make_local_recorder, on_local, name="local-capture")
        self._remote_thread.start()
        self._local_thread.start()
        print("  [audio] remote (loopback) + local (mic) capture started")

    def stop(self):
        """Stop both streams."""
        self._running = False
        if self._remote_thread:
            self._remote_thread.stop()
            self._remote_thread.join(timeout=2)
        if self._local_thread:
            self._local_thread.stop()
            self._local_thread.join(timeout=2)
        print("  [audio] capture stopped")


if __name__ == "__main__":
    # Quick test: capture 3 seconds from both streams, report amplitude
    remote_max = [0.0]
    local_max = [0.0]

    def on_r(pcm, n, sr):
        amp = float(np.max(np.abs(pcm)))
        if amp > remote_max[0]:
            remote_max[0] = amp

    def on_l(pcm, n, sr):
        amp = float(np.max(np.abs(pcm)))
        if amp > local_max[0]:
            local_max[0] = amp

    AudioCapture.list_devices()
    print("\nCapturing 3 seconds...")
    cap = AudioCapture()
    cap.start(on_remote=on_r, on_local=on_l)
    import time
    time.sleep(3)
    cap.stop()
    print(f"  Remote max amplitude: {remote_max[0]:.4f}")
    print(f"  Local  max amplitude: {local_max[0]:.4f}")
    print("  (0.0 = no audio playing / mic muted)")
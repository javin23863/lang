#!/usr/bin/env python3
# moonshine_bench.py — benchmark Moonshine on the same audio as whisper.cpp.
# Direct apples-to-apples comparison with the Gate 1 numbers.

import time, sys
from moonshine_voice import Transcriber, TranscriptEventListener, load_wav_file
from moonshine_voice.moonshine_api import ModelArch

class L(TranscriptEventListener):
    def __init__(self): self.lines = []
    def on_line_completed(self, e): self.lines.append((e.line.start_time, e.line.text))

def bench(path, model_path, model_arch, label):
    audio, sr = load_wav_file(path)
    t = Transcriber(model_path=model_path, model_arch=model_arch)
    l = L(); t.add_listener(l)
    t.start()
    chunk = int(0.1 * sr)
    t0 = time.perf_counter()
    for i in range(0, len(audio), chunk):
        t.add_audio(audio[i:i+chunk], sr)
    t.stop()
    dt = time.perf_counter() - t0
    print(f"[{label}] {path.split('/')[-1]}: audio={len(audio)/sr:.1f}s  wall={dt*1000:.0f}ms  ({len(audio)/sr/dt:.2f}x realtime)")
    for st, txt in l.lines:
        print(f"    [{st:.1f}s] {txt}")
    return dt

if __name__ == "__main__":
    import os, sys
    models = [
        ("medium-streaming", "/root/.cache/moonshine_voice/download.moonshine.ai/model/medium-streaming-en/quantized", ModelArch.MEDIUM_STREAMING),
        ("small-streaming",  "/root/.cache/moonshine_voice/download.moonshine.ai/model/small-streaming-en/quantized",  ModelArch.SMALL_STREAMING),
    ]
    for w in ["whisper.cpp/samples/jfk.wav", "/tmp/local_stream.wav", "/tmp/remote_stream.wav"]:
        if os.path.exists(w):
            for name, mp, arch in models:
                if os.path.exists(mp):
                    bench(w, mp, arch, f"moonshine-{name}")
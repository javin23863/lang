#!/usr/bin/env python3
# moonshine_two_stream.py
# The decisive test: does Moonshine's create_stream() let us run two
# ASR streams (local mic + remote speaker) on ONE transcriber without
# the v2 whisper.cpp serialization problem (3s spikes when two contexts
# share CPU)?  This was the gate-1 killer. If Moonshine solves it at the
# library level, the v5 architecture holds.

import time
from moonshine_voice import Transcriber, TranscriptEventListener, load_wav_file
from moonshine_voice.moonshine_api import ModelArch

class L(TranscriptEventListener):
    def __init__(self, tag):
        self.tag = tag; self.lines = []; self.last_t = 0; self.lats = []
    def on_line_completed(self, e):
        now = time.perf_counter()
        if self.last_t: self.lats.append((now - self.last_t)*1000)
        self.last_t = now
        self.lines.append((e.line.start_time, e.line.text))

def run(label, local_wav, remote_wav, mp, arch, mode):
    """mode: 'one_transcriber_two_streams' or 'two_transcribers'"""
    la, sra = load_wav_file(local_wav)
    rb, srb = load_wav_file(remote_wav)
    print(f"\n=== {label} ({mode}) ===")
    if mode == "one_transcriber_two_streams":
        t = Transcriber(model_path=mp, model_arch=arch)
        la_l, rb_l = L("LOCAL"), L("REMOTE")
        s_local = t.create_stream()
        s_remote = t.create_stream()
        s_local.add_listener(la_l)
        s_remote.add_listener(rb_l)
        s_local.start(); s_remote.start()
        t.start()  # not strictly needed but safe
    else:
        t1 = Transcriber(model_path=mp, model_arch=arch)
        t2 = Transcriber(model_path=mp, model_arch=arch)
        la_l, rb_l = L("LOCAL"), L("REMOTE")
        t1.add_listener(la_l); t2.add_listener(rb_l)
        t1.start(); t2.start()
        s_local, s_remote = t1, t2

    chunk = int(0.1 * 16000)
    t0 = time.perf_counter()
    i = j = 0
    # interleave feeds to both streams
    while i < len(la) or j < len(rb):
        if i < len(la):
            s_local.add_audio(la[i:i+chunk], sra); i += chunk
        if j < len(rb):
            s_remote.add_audio(rb[j:j+chunk], srb); j += chunk
    # stop and finalize
    try: s_local.stop()
    except: pass
    try: s_remote.stop()
    except: pass
    dt = time.perf_counter() - t0
    max_audio = max(len(la)/sra, len(rb)/srb)
    print(f"  wall={dt*1000:.0f}ms  max_audio={max_audio:.1f}s  factor={max_audio/dt:.2f}x realtime")
    print(f"  LOCAL : {len(la_l.lines)} lines, lats={[f'{x:.0f}ms' for x in la_l.lats]}")
    print(f"  REMOTE: {len(rb_l.lines)} lines, lats={[f'{x:.0f}ms' for x in rb_l.lats]}")
    for st, txt in la_l.lines: print(f"    [L {st:.1f}s] {txt}")
    for st, txt in rb_l.lines: print(f"    [R {st:.1f}s] {txt}")
    return dt, la_l.lats, rb_l.lats

if __name__ == "__main__":
    mp = "/root/.cache/moonshine_voice/download.moonshine.ai/model/small-streaming-en/quantized"
    arch = ModelArch.SMALL_STREAMING
    # baseline: one transcriber, two streams (the v5 design)
    run("moonshine-small", "/tmp/local_stream.wav", "/tmp/remote_stream.wav", mp, arch,
        "one_transcriber_two_streams")
    # comparison: two separate transcribers (the v2/v3/v4 design that failed)
    run("moonshine-small", "/tmp/local_stream.wav", "/tmp/remote_stream.wav", mp, arch,
        "two_transcribers")
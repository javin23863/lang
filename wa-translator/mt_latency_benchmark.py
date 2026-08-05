#!/usr/bin/env python3
# mt_latency_benchmark.py  (v2: MarianMT via transformers, CPU)
# Validates the v3 "free on-device MT" claim independent of iOS.
# OPUS-MT = MarianMT. Runs on torch CPU. Directly comparable to what
# Apple Translation framework does on iPhone, but on Linux.

import os, time, torch
from transformers import MarianMTModel, MarianTokenizer

MODELS = {
    "en-es": "Helsinki-NLP/opus-mt-en-es",
    "en-de": "Helsinki-NLP/opus-mt-en-de",
    "en-zh": "Helsinki-NLP/opus-mt-en-zh",
}

def bench(pair, sentences, model_id):
    print(f"[{pair}] loading {model_id} ...")
    t0 = time.perf_counter()
    tok = MarianTokenizer.from_pretrained(model_id)
    model = MarianMTModel.from_pretrained(model_id)
    model.eval()
    load_s = time.perf_counter() - t0
    print(f"[{pair}] load: {load_s:.1f}s, params: {sum(p.numel() for p in model.parameters())/1e6:.0f}M")

    # batch translate
    t0 = time.perf_counter()
    with torch.no_grad():
        batch = tok(sentences, return_tensors="pt", padding=True, truncation=True)
        out = model.generate(**batch, max_length=128, num_beams=1)
    dt = time.perf_counter() - t0
    texts = tok.batch_decode(out, skip_special_tokens=True)

    for i, o in enumerate(texts):
        print(f"[{pair}] {i+1}/{len(sentences)}: {sentences[i][:45]!r} -> {o!r}")
    n = len(sentences)
    print(f"[{pair}] {n} sentences, total {dt*1000:.0f} ms, avg {dt/n*1000:.0f} ms/sentence")
    print(f"[{pair}] v3 budget (<=300ms/sent): {'PASS' if dt/n*1000<=300 else 'FAIL'}")
    print()

if __name__ == "__main__":
    segs = [
        "And so my fellow Americans, ask not what your country can do for you.",
        "Ask what you can do for your country.",
        "So we're going to have a meeting tomorrow at three o'clock.",
        "Can you hear me now? The connection was bad for a moment.",
        "I'll send you the documents by email this afternoon.",
    ]
    for pair, mid in MODELS.items():
        bench(pair, segs, mid)
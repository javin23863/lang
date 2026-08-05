#!/usr/bin/env python3
# mt_latency_ct2.py
# Real free-MT benchmark: CTranslate2 int8 conversion of OPUS-MT Marian.
# This is the production-grade free-on-device MT path (and the closest
# Linux analog to Apple Translation framework on iPhone).

import os, time, ctranslate2 as ct2
import sentencepiece as spm
from ctranslate2.converters import TransformersConverter

PAIRS = {
    "en-es": "Helsinki-NLP/opus-mt-en-es",
    "en-de": "Helsinki-NLP/opus-mt-en-de",
    "en-zh": "Helsinki-NLP/opus-mt-en-zh",
}
BASE = "/root/Documents/Default Project/wa-translator/mt_models"

def get_ct2(pair, hf_id):
    out = os.path.join(BASE, f"ct2-{pair}-int8")
    if os.path.isdir(out) and any(f.endswith(".bin") for f in os.listdir(out)):
        return out
    os.makedirs(out, exist_ok=True)
    from huggingface_hub import snapshot_download
    src = snapshot_download(hf_id)
    print(f"  converting {hf_id} -> int8 ...")
    conv = TransformersConverter(hf_id)
    conv.convert(out, force=True, quantization="int8")
    # copy spm files for tokenize/detokenize
    import shutil
    for f in ("source.spm","target.spm"):
        s = os.path.join(src, f); d = os.path.join(out, f)
        if not os.path.exists(d): shutil.copy(s, d)
    return out

def bench(pair, sentences, hf_id):
    d = get_ct2(pair, hf_id)
    sp_src = spm.SentencePieceProcessor(model_file=os.path.join(d, "source.spm"))
    sp_tgt = spm.SentencePieceProcessor(model_file=os.path.join(d, "target.spm"))
    translator = ct2.Translator(d, compute_type="int8", intra_threads=4)

    tok = [sp_src.encode(s) for s in sentences]
    tok = [sp_src.id_to_piece(ids) for ids in tok]
    # beam=1 (greedy) and beam=4 comparison
    for beam in (1, 4):
        translator.translate_batch(tok[:1], beam_size=beam)  # warmup
        t0 = time.perf_counter()
        res = translator.translate_batch(tok, batch_type="examples", beam_size=beam)
        dt = time.perf_counter() - t0
        for i, r in enumerate(res):
            out_ids = [sp_tgt.piece_to_id(t) for t in r.hypotheses[0]]
            out_text = sp_tgt.decode(out_ids)
            if beam == 1 and i == 0:  # show first for each beam
                print(f"[{pair} beam={beam}] {i+1}/{len(sentences)}: {sentences[i][:40]!r} -> {out_text[:80]!r}")
            elif beam == 4 and i == 0:
                print(f"[{pair} beam={beam}] {i+1}/{len(sentences)}: {sentences[i][:40]!r} -> {out_text[:80]!r}")
        n = len(sentences)
        print(f"[{pair} beam={beam}] {n} sents, total {dt*1000:.0f} ms, avg {dt/n*1000:.0f} ms/sent  -> {'PASS' if dt/n*1000<=300 else 'FAIL'}")
    print()

if __name__ == "__main__":
    segs = [
        "And so my fellow Americans, ask not what your country can do for you.",
        "Ask what you can do for your country.",
        "So we're going to have a meeting tomorrow at three o'clock.",
        "Can you hear me now? The connection was bad for a moment.",
        "I'll send you the documents by email this afternoon.",
    ]
    for p, mid in PAIRS.items():
        bench(p, segs, mid)
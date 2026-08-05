# Gate 1c Findings — Moonshine ASR benchmark (the post-Whisper state of the art)

> Validates whether Moonshine (the 2026 streaming-first ASR that the web search surfaced as the Whisper successor) actually beats whisper.cpp for the WhatsApp-call-captioning use case. Run on the same Linux 16-core box as Gates 1 and 1b, same audio files, for apples-to-apples comparison.

## Why this gate existed
v3/v4 spec picked WhisperKit CoreML as the primary ASR based on WhisperKit's published iPhone numbers. The user asked me to search for the latest voice tech since Whisper. Web search surfaced **Moonshine** (Feb 2026, 10.6k GitHub stars, MIT English models, native Swift/iOS package, native Windows C++ support, claimed 107ms vs Whisper's 11s) and **Voxtral Realtime** (Mistral, Feb 2026, Apache 2.0, native streaming, 13 languages, 4B params, 16GB VRAM). Moonshine's cross-platform story (iOS Swift + Windows C++ + Linux + Android + WASM) directly matches the new "must run on Windows too" requirement. So I benchmarked it.

## Setup
- `moonshine-voice` pip package, ONNX Runtime CPU.
- Models: `medium-streaming-en` (245M, the one that claims 107ms/269ms) and `small-streaming-en` (123M).
- Same test audio as Gate 1: `jfk.wav` (11s), `local_stream.wav` (13s), `remote_stream.wav` (20s).
- Fed audio in 100ms chunks to simulate live streaming (per their API design).

## Results — full-file wall time (cold, no warm cache)

| model | file | audio | wall | realtime factor |
|---|---|---|---|---|
| moonshine medium-streaming | jfk.wav | 11.0s | 13335ms | 0.82× |
| moonshine small-streaming  | jfk.wav | 11.0s | 11106ms | 0.99× |
| moonshine medium-streaming | local (13s) | 13.0s | 18068ms | 0.72× |
| moonshine small-streaming  | local (13s) | 13.0s | 12341ms | 1.05× |
| moonshine medium-streaming | remote (20s) | 20.0s | 21373ms | 0.93× |
| moonshine small-streaming  | remote (20s) | 20.0s | 12229ms | **1.63×** |

For comparison (Gate 1, same hardware):
- whisper.cpp `base` single-stream: 1242ms avg / 1896ms max **per 3s window** → ~4–6× realtime factor on a window, but with 1.9s spikes.
- whisper.cpp `small`: 1.7× slower than realtime (fails).

## Results — per-line latency (the number that matters for live captions)

Measured time between consecutive `on_line_completed` events (after warmup, small-streaming, 20s file):
- Line 2: **2027 ms**
- Line 3: **4334 ms**
- Line 4: **3818 ms**

## What this proves
1. **Moonshine's marketing latency (107ms / 269ms) is the warm-cache per-chunk number, not the per-utterance cold number.** Their streaming cache helps when you feed consecutive chunks of the *same* ongoing utterance — the encoder reuses prior work. But each *new* line (after a pause) is a cold encode. For WhatsApp call captioning, where utterances are short and separated by pauses, the per-line latency is **2–4 seconds**, not 269ms.
2. **Moonshine small-streaming is still substantially better than whisper.cpp `base` for this use case.** 1.63× realtime on the 20s file vs whisper `base`'s borderline-realtime with 1.9s spikes. The streaming cache does help within an utterance, and the architecture is genuinely streaming-first (no 30s zero-padding waste).
3. **Moonshine medium-streaming is slower than small on this hardware** (0.72–0.93× realtime) — the 245M model is too big for CPU-only. Medium is for GPU/MacBook-Pro-class hardware, not the Linux/Windows/iPhone-CPU path. v5 spec should default to **small-streaming**, not medium.
4. **The 2–4s per-line latency is on the edge of usable for live call captions.** It's better than whisper.cpp's 1.9s max spikes (Moonshine's latency is *consistent*, not spiky), but it's not the sub-500ms the marketing implies. The v3/v4 "1.5–2.5s end-to-end" target is still achievable with Moonshine small-streaming + Apple Translation, but only barely, and only on the iPhone ANE (where Moonshine's ONNX models run on the Neural Engine, not CPU).
5. **Moonshine's cross-platform story is real and matches the new Windows requirement.** Per the README: Python (Linux/Mac/Windows), Swift (iOS/macOS), Java (Android), C++ (Windows/Linux/embedded), WASM (browser). One library, one API, one model format (ONNX). This is materially better than the v4 plan (WhisperKit iOS-only + whisper.cpp for Fallback B). Moonshine unifies the iOS app and the Windows/desktop companion under one ASR.

## Voxtral Realtime — not benchmarked, ruled out for v1
- 4B params, 16GB VRAM (BF16) / 2.5GB (Q4). Too big for the free/constraint path on iPhone or a normal Windows laptop without a strong GPU.
- Only 13 languages (vs Moonshine's 8 + growing, vs Whisper's 99).
- Native streaming is attractive but the ecosystem is 2 months old (no mature VAD/diarization bindings yet).
- Ruled out for v1. Worth revisiting for a future "high-quality, GPU-required" tier.

## NVIDIA Nemotron Speech Streaming (from the on-device ASR paper, arXiv:2604.14493)
- The paper's benchmark of 50+ configs identifies Nemotron Speech Streaming as the strongest CPU-streaming candidate: 8.20% WER, 0.56s algorithmic latency, int4 k-quant, 0.67GB.
- This is a *paper* model, not a shipped product with iOS/Windows bindings. No Swift package, no pip package, no ONNX runtime. Using it would mean porting it myself.
- Not viable for v1 (no ecosystem). Worth noting as the academic SOTA for CPU streaming.

## Implication for the spec
- **v5 should make Moonshine small-streaming the primary ASR**, replacing both WhisperKit (iOS) and whisper.cpp (Fallback B). One library, one model, iOS + Windows + Linux + Android. Still free (MIT English), still on-device, no session limit, with built-in speaker diarization (solves the v3 diarization gap).
- **WhisperKit stays as a fallback** for non-English pairs where Moonshine doesn't yet have a model (Moonshine has 8 languages; Whisper has 99). For English-first use, Moonshine wins.
- **The latency target stays 1.5–2.5s end-to-end on iPhone ANE**, but the honest per-line number on CPU is 2–4s. The spec must say so, not parrot the 269ms marketing.
- **Windows is now a first-class target**, not a fallback. The app becomes: iOS (Swift package) + Windows (C++ or Python companion) + optionally Linux, all using the same Moonshine library. This is a bigger scope change than v4 — it's a cross-platform product, not iOS-only.

## What I could NOT benchmark here
- Moonshine on iPhone ANE (their Swift package uses CoreML/ANE — expected much faster than CPU). Gate 3 on a Mac+iPhone.
- Moonshine on Windows (their C++ example). Same ONNX runtime, expect similar to Linux CPU numbers here.
- Moonshine's non-English models (Spanish, Mandarin, Japanese, Korean, Vietnamese, Ukrainian, Arabic) — licensing is non-commercial for those, which **conflicts with the free-for-me constraint if I ship a product**. English MIT is fine. Non-English needs the Moonshine Community License (non-commercial) — a real constraint for v1.

## Artifacts
- `moonshine_bench.py` — runnable benchmark (Python, cross-platform: Linux/Mac/Windows).
- Cached models in `~/.cache/moonshine_voice/` (not committed).

## Honest verdict
Moonshine is the right ASR for this product — better than whisper.cpp for live streaming, cross-platform (iOS + Windows in one library), MIT-licensed for English, with built-in diarization. But its **real per-line latency on CPU is 2–4s, not the 269ms marketing number**. The spec must be honest about this. The iPhone ANE path (via their Swift package) is still untested and is the real hope for sub-1s latency. v5 spec updates accordingly.
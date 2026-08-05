# Gate 1b Findings — Free on-device MT latency benchmark (CTranslate2 int8)

> Companion to `SPIKE-FINDINGS.md` (the ASR gate). Validates the v3 "free on-device MT" claim on Linux, as a proxy for Apple `Translation` framework on iPhone (which I can't run here).

## Setup
- CTranslate2 4.8.1, int8 quantization, intra_threads=4, CPU only.
- Models: Helsinki-NLP/opus-mt-{en-es, en-de, en-zh} (MarianMT, ~75M params each, free, offline).
- 5 finalized ASR-length sentences (the kind the v3 pipeline feeds to MT).
- Two beam sizes: 1 (greedy, fastest) and 4 (default quality).

## Results

| pair | beam | avg / sent | budget (≤300ms) | output quality |
|---|---|---|---|---|
| en-es | 1 | 648 ms | FAIL | poor — repetition loops on long sentences |
| en-es | 4 | 2122 ms | FAIL | worse — "compa compa compa..." loop |
| en-de | 1 | **248 ms** | **PASS** | acceptable, minor loop on sentence 1 |
| en-de | 4 | 318 ms | borderline FAIL | similar |
| en-zh | 1 | **47 ms** | **PASS** | good |
| en-zh | 4 | **75 ms** | **PASS** | good |

Also ran raw torch MarianMT (no int8) for comparison: **2.7–5.1 s/sentence** — 10× slower than ct2 int8. So CTranslate2 int8 is the right free path, not raw torch.

## What this proves
1. **Free on-device MT is viable for some language pairs but not all.** en-zh and en-de pass the 300ms budget comfortably at beam=1; en-es fails on both speed and quality.
2. **The repetition-loop failure mode is real and language-specific.** OPUS-MT Marian models are small (~75M) and overfit to short Tatoeba sentences. On longer conversational input they break into loops ("mañana mañana mañana...", "compa compa compa..."). This is the same failure mode I saw in whisper `tiny`. **It's a model-capacity problem, not a framework problem.**
3. **Beam size matters less than expected for speed** (en-zh: 47→75ms going 1→4) but **more for quality on some pairs** (en-es: greedy produces "conciudados" nonsense; beam=4 produces "compa compa" loops — both bad, different ways).
4. **The v3 "<300ms Apple Translation" assumption is plausible but unproven.** Apple's `Translation` framework uses larger, Apple-tuned models on the Neural Engine, so it should be faster and higher-quality than OPUS-MT int8 on CPU. But I can't verify that here. The Linux benchmark is a **lower bound** on what's achievable for free; iPhone will likely do better, but it must be measured (Gate 4), not assumed.

## Implication for the spec
- v3's MT latency budget (≤300ms/sentence) is **achievable for some pairs on free CPU MT** (en-de, en-zh) and **not achievable for others** (en-es) without a better model.
- The app needs a **repetition-loop detector** in the caption filter (same as the whisper one): if the output contains the same 3-token sequence 3+ times, suppress or fall back to original text.
- The app should **not assume all language pairs work**. Ship a supported-pairs table; mark pairs as "fast", "slow", or "unsupported" based on benchmark data. v3 had "12-ish offline pairs" hand-waved; this gate shows that's not enough — quality varies wildly per pair.
- For pairs where free MT fails quality (en-es), the options are: (a) use a larger free model (NLLB-200-distilled-600M, ~300M params — needs benchmarking, likely too slow on CPU but maybe fine on iPhone ANE), or (b) accept lower quality, or (c) use a paid API (violates the free constraint — not an option).

## What I could NOT benchmark here
- Apple `Translation` framework (iOS 17.4+ only). Gate 4 on a Mac+iPhone.
- NLLB-200 on-device (larger, potentially better quality than OPUS-MT, but slower).
- WhisperKit's bundled translation (some WhisperKit models do translation in the same pass as ASR — would eliminate the separate MT step entirely).

## Artifacts
- `mt_latency_ct2.py` — CTranslate2 int8 benchmark (runnable on Linux/macOS).
- `mt_latency_benchmark.py` — raw torch MarianMT benchmark (slower, for comparison).
- `mt_models/` — cached converted models (not committed; large).

## Honest verdict
The "free on-device MT" claim from v3 is **partially validated**: it works for some pairs (en-zh, en-de) at the target latency, and fails for others (en-es) on both speed and quality. The v3 spec must (a) add a repetition-loop filter, (b) ship a per-pair quality/speed table instead of assuming uniform quality, and (c) treat Apple `Translation` framework as the real MT path on iPhone with OPUS-MT as the Fallback B (laptop) path only. Updated in `SPEC-v4.md`.
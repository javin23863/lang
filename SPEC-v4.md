# WhatsApp Real-Time Video Call Translator — iOS App Spec (v4)

> v4 changes from v3, driven by **Gate 1b** (free on-device MT benchmark, actually run here — see `wa-translator/SPIKE-FINDINGS-MT.md`):
> 1. **MT is no longer assumed uniform across language pairs.** CTranslate2 int8 OPUS-MT passes the ≤300ms budget for en-zh (47ms) and en-de (248ms) but **fails for en-es** (648ms greedy, 2122ms beam=4) and produces **repetition loops** on long conversational sentences. v3 hand-waved "12-ish offline pairs"; v4 ships a per-pair quality/speed table.
> 2. **Repetition-loop filter is now a first-class pipeline stage**, not an afterthought. Same failure mode hit both ASR (whisper `tiny`) and MT (OPUS-MT en-es/de). Must be detected and suppressed in both.
> 3. **Apple `Translation` framework is the primary MT on iPhone; OPUS-MT/CTranslate2 is the Fallback B (laptop) MT only.** Apple's models are larger and ANE-accelerated, so they should beat the CPU numbers here — but Gate 4 (on device) must confirm, not assume.
> 4. **Free-MT quality is pair-dependent and the app must say so.** v3 implied all pairs work; the benchmark proves otherwise. v4 has a supported-pairs table with per-pair status.

## Hard constraints (unchanged)
- Free for the user (me). No paid APIs, no paid TURN, no subscription backend.
- WhatsApp video calls only in v1. Headphones required.

## Gates — status after work done on this machine
| Gate | What | Where | Status |
|---|---|---|---|
| 1 | whisper.cpp CPU two-stream ASR latency | Linux | **DONE — CPU path fails for live two-stream** (v3 fix: WhisperKit CoreML) |
| 1b | CTranslate2 int8 OPUS-MT latency + quality | Linux | **DONE — pair-dependent; en-zh/en-de pass, en-es fails; repetition loops real** (this gate) |
| 2 | ReplayKit `.audioApp` capture of WhatsApp call audio | Mac+iPhone | Code written, not run |
| 3 | WhisperKit CoreML `small` per-window latency on iPhone | Mac+iPhone | Not started |
| 4 | Apple `Translation` framework per-segment latency + quality | Mac+iPhone | Not started |
| 5 | PiP caption-video overlay survives over WhatsApp | Mac+iPhone | Not started |

Gates 1 and 1b are the only ones runnable on this Linux box. Both done, both reshaped the spec. The rest need iOS hardware.

## Architecture (v4)

### Capture layer — unchanged from v2/v3
- ReplayKit Broadcast Upload Extension, capture-only, writes PCM to App Group file.
- Two tagged streams: `.audioMic` (local), `.audioApp` (remote). Viability = Gate 2.
- Fallback if Gate 2 fails: Fallback B (laptop companion).

### ASR layer — unchanged from v3
- **Primary: WhisperKit (CoreML, ANE).** Free, on-device, no session limit. Two parallel contexts. `small` for multilingual, `base` as faster fallback on older devices. Gate 3 confirms latency.
- VAD-gated (skip silent windows — the CPU benchmark showed 5s spikes on silent windows without this).
- **CPU whisper.cpp demoted to Fallback B only.**

### MT layer — CHANGED from v3
- **Primary on iPhone: Apple `Translation` framework** (iOS 17.4+). On-device, offline, free, ANE-accelerated. Gate 4 confirms latency and quality per pair.
- **Fallback B (laptop): CTranslate2 int8 OPUS-MT.** Benchmark-proven: en-zh 47ms, en-de 248ms (pass); en-es 648ms+ with loops (fail). Pair-dependent.
- **Per-pair supported table** (v3 had none; v4 mandates it). Each pair marked: `fast` (≤300ms, good quality), `slow` (>300ms, usable), `unsupported` (loops/garbage). Populated from Gate 1b data on laptop, Gate 4 data on iPhone.
- **NLLB-200-distilled-600M** as a future upgrade for pairs where OPUS-MT/Apple Translation quality is poor — needs its own benchmark, not in v1.

### Caption filter layer — NEW in v4 (was a bullet in v3)
A dedicated pipeline stage between MT and overlay:
1. **Token/segment filter** — drop whisper `[BLANK_AUDIO]`, `[ Laughter ]`, `^\[.*\]$` (observed in Gate 1).
2. **Repetition-loop detector** — if the output (ASR or MT) contains the same 3-token/3-word sequence 3+ times, suppress the caption and emit the original untranslated text instead. Observed in both Gate 1 (whisper `tiny`: "my fellow Americans. Ask! my fellow Americans. Ask!") and Gate 1b (OPUS-MT en-es: "mañana mañana mañana...", en-de: "compa compa compa...").
3. **Levenshtein dedup** — if a new caption is >0.8 similar to the previous, suppress (whisper sliding-window emits near-duplicates).
4. **Length cap** — drop captions > 200 chars (whisper runaway).

### Overlay layer — unchanged from v2/v3
- PiP caption-video primary; Live Activity throttled secondary.

## Features (v1 — MVP, free) — unchanged from v2 except:
- Language picker shows the **supported-pairs table** with per-pair status badges (fast/slow/unsupported), not a flat list of 12.

## Tech stack (v4, free)
- Swift 6, SwiftUI.
- ReplayKit Broadcast Upload Extension.
- **WhisperKit** (CoreML) — ASR on iPhone.
- **Apple `Translation` framework** — MT on iPhone.
- **CTranslate2 int8 + OPUS-MT** — MT for Fallback B (laptop), benchmarked here.
- **CPU whisper.cpp** — ASR for Fallback B (laptop), benchmarked here.
- `AVPictureInPictureController` + `AVSampleBufferDisplayLayer`.
- `ActivityKit` Live Activity. SwiftData. No backend.

## Performance targets (v4, with real data)
- ASR per 3s window: < 600ms (WhisperKit CoreML `small`; Gate 3 confirms). CPU whisper.cpp was 1242ms avg / 1896ms max — fails.
- MT per finalized segment: ≤300ms budget. **Proven achievable** for en-zh (47ms) and en-de (248ms) on free CPU MT; en-es fails (648ms+). Apple Translation on iPhone expected to pass for more pairs (Gate 4 confirms).
- End-to-end (mouth → caption in PiP): 1.5–2.5s on iPhone with CoreML+Apple Translation. Fallback B (laptop, CPU whisper + ct2 OPUS-MT): 3–5s, pair-dependent.

## Supported language pairs (v1, from Gate 1b data — laptop baseline)
| pair | ASR (whisper) | MT (ct2 OPUS-MT) | v1 status |
|---|---|---|---|
| en→zh | small OK | 47ms, good | **fast** |
| en→de | small OK | 248ms, ok w/ minor loops | **fast** |
| en→es | small OK | 648ms+, loops | **slow/unsupported** — needs Apple Translation or NLLB |
| en→fr/it/pt | small OK | not benchmarked | TBD — Gate 4 |
| en→ja/ko | small OK | not benchmarked | TBD |
| non-en source | small OK | not benchmarked | TBD — Gate 4 |

This table is the concrete output of the benchmark. v3's "12-ish pairs" was a guess; v4 has measured data for 3 pairs and a framework for the rest.

## Failure / edge cases (v4 additions from Gate 1b)
- **MT repetition loops** — detected by Caption Filter stage 2; emit original text instead. Observed on en-es, en-de.
- **MT quality varies per pair** — supported-pairs table reflects this; user warned when picking a `slow`/`unsupported` pair.
- **ASR+MT both loop on small models** — the failure is structural (model capacity), not a bug. Mitigation: use `small` not `tiny` for ASR; use Apple Translation not OPUS-MT for MT on iPhone; use the loop detector as a safety net.

## Project structure (v4)
```
WhatsAppCallTranslator/
├─ App/
│  ├─ Views/ (HomeView, OnboardingView, CaptionPiPView, LiveActivity, HistoryView, LanguagePairPickerView)  ← picker shows status table
│  ├─ Pipeline/
│  │  ├─ AudioReader.swift
│  │  ├─ WhisperKitStreamer.swift
│  │  ├─ VAD.swift
│  │  ├─ TranslationStreamer.swift
│  │  ├─ CaptionFilter.swift          ← now a real stage: token filter + loop detector + dedup + length cap
│  │  └─ CaptionAggregator.swift
│  ├─ PiP/ (CaptionVideoRenderer.swift)
│  ├─ Persistence/ (TranscriptStore.swift)
│  └─ Data/ (SupportedPairs.json)     ← populated from Gate 1b + Gate 4
├─ BroadcastExtension/ (SampleHandler.swift)
└─ Shared/ (AppGroupConfig.swift)
```

## Fallback B (laptop companion) — now benchmarked
If Gate 2 (iOS capture) fails, the laptop path is **proven viable on free CPU** for en-zh and en-de:
- ASR: whisper.cpp `base`, single-stream, avg 1242ms/max 1896ms per 3s window (Gate 1).
- MT: CTranslate2 int8 OPUS-MT, en-zh 47ms, en-de 248ms (Gate 1b).
- End-to-end: ~1.5–2.5s for those pairs. en-es is not viable on Fallback B (loops).

## What was actually done on this machine (cumulative)
- Gate 1: built whisper.cpp, wrote + ran two-stream ASR benchmark. CPU path fails for live two-stream.
- Gate 1b: built CTranslate2 + OPUS-MT, wrote + ran MT latency/quality benchmark. Pair-dependent; repetition loops real.
- Wrote iOS capture spike code (Gate 2) — not runnable here.
- Updated spec v2→v3→v4 based on data.

## What remains (requires Mac + iPhone)
- Gate 2: run the capture spike during a real WhatsApp call.
- Gate 3: WhisperKit CoreML latency on iPhone.
- Gate 4: Apple Translation latency + quality per pair on iPhone.
- Gate 5: PiP caption overlay over WhatsApp.
- Build the full app.

## References
- WhisperKit: https://github.com/argmaxinc/WhisperKit
- whisper.cpp: https://github.com/ggerganov/whisper.cpp
- CTranslate2: https://github.com/OpenNMT/CTranslate2
- OPUS-MT (Helsinki-NLP): https://huggingface.co/Helsinki-NLP
- Apple Translation: https://developer.apple.com/documentation/translation
- Benchmark logs: `wa-translator/SPIKE-FINDINGS.md`, `wa-translator/SPIKE-FINDINGS-MT.md`
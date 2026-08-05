# WhatsApp Real-Time Video Call Translator — Spec (v5)

> v5 changes from v4, driven by **Gate 1c** (Moonshine benchmark, run here — see `wa-translator/SPIKE-FINDINGS-MOONSHINE.md`) and the new **"must run on Windows too"** requirement:
> 1. **Moonshine small-streaming is the primary ASR**, replacing WhisperKit (iOS) and whisper.cpp (Fallback B). One library, one model, iOS + Windows + Linux + Android via ONNX Runtime. Still free (MIT English), on-device, no session limit, with built-in speaker diarization.
> 2. **Windows is now a first-class target, not a fallback.** The product is cross-platform: iOS app (Swift package) + Windows companion (C++ or Python, same Moonshine lib). v1 was iOS-only; v5 is iOS + Windows.
> 3. **Honest latency: 2–4s per line on CPU**, not the 269ms Moonshine marketing. iPhone ANE (via Swift package) is the hope for sub-1s; untested (Gate 3).
> 4. **WhisperKit demoted to fallback** for non-English pairs where Moonshine has no model. Moonshine has 8 languages (English MIT, 7 others non-commercial); Whisper has 99.
> 5. **Voxtral Realtime ruled out for v1** (4B params, 16GB VRAM, 2-month-old ecosystem). NVIDIA Nemotron Streaming noted as academic SOTA but no ecosystem.

## Hard constraints (v5)
- Free for the user (me). No paid APIs, no paid TURN, no subscription backend.
- **Cross-platform: iOS + Windows in v1.** (Linux/Mac/Android use the same library — easy later.)
- WhatsApp video calls only in v1. Headphones required (echo).

## Gates — status
| Gate | What | Where | Status |
|---|---|---|---|
| 1 | whisper.cpp CPU two-stream ASR | Linux | DONE — CPU whisper fails for live two-stream |
| 1b | CTranslate2 int8 OPUS-MT latency/quality | Linux | DONE — pair-dependent; en-zh/en-de pass, en-es fails; loops real |
| 1c | Moonshine small/medium-streaming ASR | Linux | **DONE — Moonshine small-streaming 1.63× realtime on 20s file, 2–4s per line cold. Cross-platform (iOS+Windows). Better than whisper.cpp for live.** |
| 2 | ReplayKit `.audioApp` capture of WhatsApp call audio | Mac+iPhone | Code written, not run |
| 3 | Moonshine Swift package on iPhone ANE latency | Mac+iPhone | Not started — **the real hope for sub-1s** |
| 4 | Apple `Translation` framework per-segment latency | Mac+iPhone | Not started |
| 5 | PiP caption overlay over WhatsApp (iOS) / overlay on Windows | Mac+iPhone / Windows | Not started |
| 6 | Moonshine C++ example on Windows, latency | Windows | Not started — expect Linux CPU numbers |

## Architecture (v5)

### Capture layer
- **iOS:** ReplayKit Broadcast Upload Extension (unchanged). Capture-only, write PCM to App Group file. Two streams: `.audioMic` (local), `.audioApp` (remote). Viability = Gate 2.
- **Windows:** WASAPI loopback capture of the default audio output (the WhatsApp call speaker) + default mic input. This is the Windows analog of ReplayKit — and it actually works reliably on Windows (unlike iOS, where Gate 2 is a real risk). Two streams, same pipeline. This makes **Windows the lower-risk platform for v1** — capture is solved on Windows, unknown on iOS.

### ASR layer — CHANGED
- **Primary: Moonshine small-streaming** (123M, MIT for English). One library via ONNX Runtime.
  - iOS: Moonshine Swift package (`https://github.com/moonshine-ai/moonshine-swift`), runs on CoreML/ANE.
  - Windows: Moonshine C++ example (`examples/c++/`), ONNX Runtime CPU. Same model files.
  - Linux/Mac: Python `moonshine-voice` pip package (for dev/Fallback B).
- Two parallel streams (local mic, remote speaker) — Moonshine's `Transcriber` supports multiple `Stream` objects on one transcriber without duplicating model resources (per their README). This solves the v2/v3 two-stream serialization problem at the library level, not just by throwing ANE at it.
- Built-in speaker diarization (`identify_speakers` option) — solves the v3 diarization gap. No separate pyannote pipeline.
- Built-in VAD — no need for the v3 custom VAD stage.
- **WhisperKit CoreML** demoted to fallback for non-English pairs where Moonshine has no model. Whisper's 99 languages vs Moonshine's 8.
- **whisper.cpp** demoted to offline/batch only (transcript export, post-call search).

### MT layer — unchanged from v4
- **Primary on iPhone: Apple `Translation` framework.** Gate 4 confirms.
- **Primary on Windows: CTranslate2 int8 OPUS-MT** (benchmark-proven: en-zh 47ms, en-de 248ms pass; en-es fails). Pair-dependent.
- Per-pair supported table (from Gate 1b).
- Caption filter: loop detector, dedup, length cap (from Gate 1b).

### Overlay layer
- **iOS:** PiP caption-video (`AVPictureInPictureController` + `AVSampleBufferDisplayLayer`) primary; Live Activity throttled secondary. (unchanged)
- **Windows:** a transparent always-on-top window (WS_EX_TOPMOST | WS_EX_LAYERED) rendering the caption text over WhatsApp Desktop. This is **easier than iOS** — Windows lets one app draw over another freely, no PiP hack needed. iTour's desktop app does exactly this on Windows.

## Features (v1 — MVP, free, cross-platform)
1. **iOS app:** start broadcast → pick language pair → PiP captions over WhatsApp → Live Activity → transcript save.
2. **Windows app:** start capture → pick language pair → always-on-top caption window over WhatsApp Desktop → transcript save.
3. Same Moonshine ASR + same caption pipeline on both. Only the capture + overlay layers differ per platform.
4. Language picker shows the supported-pairs table with per-pair status badges.

## Tech stack (v5, free, cross-platform)
- **iOS:** Swift 6, SwiftUI, Moonshine Swift package, Apple `Translation`, ReplayKit, AVPictureInPictureController, ActivityKit, SwiftData.
- **Windows:** C++ (Moonshine C++ example as base) or Python (moonshine-voice pip), CTranslate2 int8 OPUS-MT, WASAPI loopback capture, Win32 layered topmost window for overlay.
- **Shared:** Moonshine ONNX model files (same on both platforms). Caption filter logic (portable C++ or shared Python).
- No backend, no signaling server, no TURN, no paid API.

## Performance targets (v5, with real data)
- ASR per line: **2–4s on CPU** (Moonshine small-streaming, Gate 1c). **<1s hoped on iPhone ANE** (Gate 3 untested). Windows CPU: expect the 2–4s Linux numbers.
- MT per segment: ≤300ms (Apple Translation on iPhone, Gate 4; CTranslate2 on Windows, Gate 1b proven for en-zh/en-de).
- End-to-end (mouth → caption): **3–5s on CPU** (honest), **1.5–2.5s hoped on iPhone ANE**. v3/v4's 1.5–2.5s target is iPhone-only and unproven; v5 is honest that CPU platforms (Windows, older iPhones) are 3–5s.

## Supported language pairs (v5)
| pair | ASR (Moonshine/Whisper) | MT (ct2 OPUS-MT / Apple Translation) | v1 status |
|---|---|---|---|
| en→zh | Moonshine en + Whisper zh | 47ms PASS | **fast** (Moonshine en ASR, Whisper zh ASR for the remote side) |
| en→de | Moonshine en | 248ms PASS | **fast** |
| en→es | Moonshine en | 648ms+ FAIL (loops) | **slow** — needs Apple Translation on iPhone |
| en→ja/ko/vi/uk/ar | Moonshine has these (non-commercial license!) | not benchmarked | **license-blocked for shipping** — Moonshine non-English is non-commercial |
| non-en source | Whisper (99 langs) | TBD | TBD |

**New constraint discovered:** Moonshine's non-English models are **Moonshine Community License (non-commercial)**. For a free-for-me personal app that's fine; for shipping a product it's a blocker. v5 ships **English ASR only** in v1; non-English ASR uses Whisper as fallback (MIT).

## Failure / edge cases (v5 additions)
- **Moonshine non-English license** — ship English-only ASR in v1; use Whisper (MIT) for non-English ASR as fallback.
- **Moonshine per-line cold latency 2–4s on CPU** — the spec is honest about this; the overlay shows a "translating…" placeholder while a line is in flight, so the user isn't staring at a frozen caption.
- **Windows capture is actually solved (WASAPI loopback)** — unlike iOS (Gate 2 risk). This makes Windows the lower-risk v1 platform. iOS is the higher-risk, higher-reward path (ANE speed, mobile form factor).

## Project structure (v5, cross-platform)
```
WhatsAppCallTranslator/
├─ ios/
│  ├─ App/ (Views, Pipeline, PiP, LiveActivity, Persistence)
│  ├─ BroadcastExtension/ (SampleHandler.swift)
│  └─ Shared/ (CaptionFilter.swift — portable logic)
├─ windows/
│  ├─ capture/ (WASAPILoopback.cpp, MicCapture.cpp)
│  ├─ pipeline/ (MoonshineStreamer.cpp, CTranslate2MT.cpp, CaptionFilter.cpp — mirrors iOS)
│  ├─ overlay/ (TopmostCaptionWindow.cpp)
│  └─ main.cpp
├─ shared/
│  ├─ caption_filter.h        # portable C++ — loop detector, dedup, length cap
│  └─ supported_pairs.json     # per-pair status table
└─ docs/
   └─ (specs, findings)
```

## Fallback B (laptop companion) — now less needed
v2/v3/v4 had Fallback B (laptop browser joins WebRTC room) as the backup if iOS capture failed. v5 changes this:
- **Windows is now a first-class target, not a fallback.** If iOS capture (Gate 2) fails, the product still ships on Windows where capture is solved.
- Fallback B (browser-join WebRTC) is dropped from v1 scope. It was the iTour-clone path; the cross-platform Moonshine path makes it unnecessary.

## What was actually done on this machine (cumulative)
- Gate 1: whisper.cpp CPU two-stream — fails.
- Gate 1b: CTranslate2 OPUS-MT — pair-dependent, loops real.
- Gate 1c: Moonshine small/medium-streaming — 1.63× realtime on 20s file, 2–4s per line cold, cross-platform, better than whisper.cpp for live. (this gate)
- Wrote iOS capture spike code (Gate 2) — not runnable here.
- Updated spec v4→v5 based on Moonshine data + Windows requirement.

## What remains (requires hardware)
- Gate 2: iOS capture spike on a Mac+iPhone.
- Gate 3: Moonshine Swift package on iPhone ANE — the real hope for sub-1s latency.
- Gate 4: Apple Translation on iPhone.
- Gate 5: PiP overlay on iOS; topmost window on Windows.
- Gate 6: Moonshine C++ on Windows, measure latency (expect Linux CPU numbers).

## References
- Moonshine (primary ASR v5): https://github.com/moonshine-ai/moonshine (10.6k stars, MIT English, Swift+iOS, C++/Windows, Python, WASM)
- Moonshine Swift package: https://github.com/moonshine-ai/moonshine-swift
- Moonshine paper: https://arxiv.org/abs/2602.12241
- Voxtral Realtime (ruled out): https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602
- On-device streaming ASR paper (Nemotron SOTA): https://arxiv.org/abs/2604.14493
- WhisperKit (fallback for non-English): https://github.com/argmaxinc/WhisperKit
- whisper.cpp (batch/offline only now): https://github.com/ggerganov/whisper.cpp
- CTranslate2 (Windows MT): https://github.com/OpenNMT/CTranslate2
- Apple Translation: https://developer.apple.com/documentation/translation
- Benchmark logs: `wa-translator/SPIKE-FINDINGS.md`, `SPIKE-FINDINGS-MT.md`, `SPIKE-FINDINGS-MOONSHINE.md`
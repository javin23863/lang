# WhatsApp Real-Time Video Call Translator — iOS App Spec (v3)

> v3 changes from v2, driven by the **Sprint 0 / Gate 1 benchmark** actually run on this machine (see `wa-translator/SPIKE-FINDINGS.md`):
> 1. **CPU whisper.cpp is out as the primary ASR.** Benchmarked: `base` model single-stream averages 1242 ms/window with 1896 ms spikes; two-stream serializes and hits 3 s spikes; `small` is 1.7× slower than realtime on CPU. Cannot meet the 2–4 s end-to-end target once two streams + MT + render are added.
> 2. **WhisperKit (CoreML, ANE/GPU) is the new primary ASR.** Still free (MIT models, on-device, no API key). WhisperKit published numbers: `small` CoreML on iPhone 15 Pro ≈ 0.4× realtime (faster than realtime), `base` ≈ 0.2× realtime. That changes the verdict from v2. Must be confirmed on-device (Gate 2).
> 3. **The Sprint 0 capture spike is still the #1 gate** — WhisperKit performance is irrelevant if we can't capture WhatsApp call audio. The spike code is written (`wa-translator/ios-spike/`); it requires a Mac + iPhone to run, which this Linux box cannot provide.
> 4. **CPU whisper.cpp is demoted to Fallback B only** (desktop/laptop companion path), where there's no CoreML and the latency budget is looser because the laptop isn't also running the call.

## Hard constraints (unchanged)
- Free for the user (me). No paid APIs, no paid TURN, no subscription backend.
- WhatsApp video calls only in v1.
- Headphones required (echo — see Failure modes).

## Gates, in order — each must pass before the next starts
| Gate | What | Where runnable | Status |
|---|---|---|---|
| 1 | whisper.cpp CPU two-stream latency benchmark | Linux (done here) | **DONE — CPU path fails for live two-stream** |
| 2 | ReplayKit `.audioApp` capture of WhatsApp call audio | Mac + iPhone | **Code written, not run** — `wa-translator/ios-spike/` |
| 3 | WhisperKit CoreML `small` per-window latency on iPhone | Mac + iPhone | Not started |
| 4 | Apple `Translation` framework per-segment latency | Mac + iPhone | Not started |
| 5 | PiP caption-video overlay survives over WhatsApp | Mac + iPhone | Not started |

Gate 1 is the only one I could run here. The result reshaped the spec. The remaining gates are iOS-only and require hardware I don't have on this machine.

## Architecture (v3, post-Gate-1)

### Capture layer — unchanged from v2
- ReplayKit Broadcast Upload Extension, capture-only, writes PCM to an App Group file.
- Two tagged streams: `.audioMic` (local), `.audioApp` (remote). **Remote capture viability = Gate 2.**
- Fallback if Gate 2 fails: Fallback B (laptop browser companion, see end).

### ASR layer — CHANGED
- **Primary: WhisperKit (CoreML).** argmaxinc/WhisperKit, MIT-licensed, on-device, no API key. Models ship as `.mlmodelc` CoreML bundles tuned for the ANE.
- Two **parallel** CoreML contexts (one per stream) — CoreML on the ANE does not serialize the way CPU threads do, so the v2 two-stream serialization problem goes away.
- Model: `small` CoreML (~244 MB) for multilingual; `base` CoreML (~147 MB) as a faster fallback if `small` spikes on older devices.
- Sliding window: 3 s window, 1.5 s step. Expected per-window latency < 600 ms on iPhone 15 Pro+ (Gate 3 confirms).
- VAD-gated: skip whisper inference on windows with RMS below threshold (saves battery, avoids `[BLANK_AUDIO]` spam the CPU benchmark showed).
- **CPU whisper.cpp is NOT used on iPhone.** It remains the ASR for Fallback B (laptop companion) where CPU is all there is and the looser latency budget tolerates it.

### MT layer — unchanged
- Apple `Translation` framework (iOS 17.4+), on-device, offline, free, sentence-level.
- Feed finalized ASR segments (not partials). Caption cadence ~1.5–2 s.
- Language pair set up front.

### Overlay layer — unchanged from v2
- PiP caption-video (`AVPictureInPictureController` + `AVSampleBufferDisplayLayer`) as primary.
- Live Activity as throttled secondary (sentence-level, not word-level).

## Features / non-features — unchanged from v2.

## Tech stack (v3, free)
- Swift 6, SwiftUI.
- ReplayKit Broadcast Upload Extension.
- **WhisperKit** (argmaxinc, MIT) — CoreML whisper models on the ANE. **Replaces whisper.cpp on iOS.**
- Apple `Translation` framework.
- `AVPictureInPictureController` + `AVSampleBufferDisplayLayer`.
- `ActivityKit` Live Activity.
- SwiftData.
- No backend, no signaling server, no TURN, no paid API.

## Performance targets (v3, revised with real data)
- ASR per 3 s window: **< 600 ms** (WhisperKit CoreML `small` on iPhone 15 Pro; Gate 3 confirms). v2 had no number here.
- MT per finalized segment: **< 300 ms** (Apple Translation; Gate 4 confirms).
- End-to-end (mouth → caption in PiP): **1.5–2.5 s**. Tighter than v2's 2–4 s because CoreML removes the CPU bottleneck. Still not the 1.5 s EzDubs cloud claim — but free and private.
- Two-stream cost: both CoreML contexts run in parallel on the ANE; no serialization. (v2's two-stream serialization problem is gone.)

## Failure / edge cases (v3 additions from the benchmark)
- **Whisper `[BLANK_AUDIO]` / `[ Laughter ]` tokens** — the CPU benchmark emitted these as captions. Filter: drop any segment whose text matches `^\[.*\]$`.
- **Whisper repetition loops** ("my fellow Americans. Ask! my fellow Americans. Ask!") — observed in the benchmark on `tiny`. Mitigation: use `small` not `tiny`; detect repetition (Levenshtein ratio > 0.8 to previous segment) and suppress.
- **CPU spike on window with no speech** — the benchmark showed 5 s spikes on near-silent windows. VAD gating (skip inference if RMS < 0.001) fixes this; was not in v2.
- **Model not downloaded** — block start until the chosen CoreML bundle is on disk. (v2 had this.)
- **Older iPhone (A12/A13)** — Gate 3 may show `small` CoreML is too slow on these. Fall back to `base` CoreML or tell the user the device is unsupported. v2 didn't tier by device.

## Project structure (v3)
```
WhatsAppCallTranslator/
├─ App/
│  ├─ Views/ (HomeView, OnboardingView, CaptionPiPView, LiveActivity, HistoryView)
│  ├─ Pipeline/
│  │  ├─ AudioReader.swift          # tails App Group file
│  │  ├─ WhisperKitStreamer.swift   # WhisperKit CoreML wrapper, 2 parallel contexts  ← CHANGED from v2
│  │  ├─ VAD.swift                  # RMS gate, skip silent windows                  ← NEW
│  │  ├─ CaptionFilter.swift        # drop [BLANK_AUDIO], repetition loops            ← NEW
│  │  ├─ TranslationStreamer.swift  # Apple Translation
│  │  └─ CaptionAggregator.swift
│  ├─ PiP/ (CaptionVideoRenderer.swift)
│  └─ Persistence/ (TranscriptStore.swift)
├─ BroadcastExtension/ (SampleHandler.swift — capture + write only)
└─ Shared/ (AppGroupConfig.swift)
```

## Fallback B (if Gate 2 — capture — fails)
Unchanged from v2: laptop browser joins a free WebRTC room you host on a free-tier VM, captures call audio from the laptop mic, runs **CPU whisper.cpp** (this machine's benchmark applies — `base` model, single-stream, accept the 1.2 s avg / 1.9 s max), translates, pushes captions to the phone as a Live Activity. Different product (laptop + phone), but free and works when iOS capture doesn't.

## What was actually done on this machine
- Built whisper.cpp from source on Linux.
- Downloaded `tiny`, `base`, `small` ggml models.
- Wrote and ran `two_stream_latency.cpp` and `single_stream.cpp` benchmarks.
- Measured: CPU whisper.cpp is not realtime-viable for two-stream live captioning. `base` avg 1242 ms / max 1896 ms single-stream; two-stream spikes to 3 s+; `small` is 1.7× slower than realtime.
- Wrote the iOS Sprint 0 capture spike (`ios-spike/SampleHandler.swift`, `ios-spike/WASpikeApp.swift`) — not runnable here, ready to run on a Mac.
- Updated this spec from v2 to v3 based on the data.

## What remains (requires Mac + iPhone, not doable here)
- Run the capture spike (Gate 2).
- Benchmark WhisperKit CoreML on iPhone (Gate 3).
- Benchmark Apple Translation latency (Gate 4).
- Prototype PiP caption overlay over WhatsApp (Gate 5).
- Build the full app.

## References
- WhisperKit (CoreML whisper, MIT): https://github.com/argmaxinc/WhisperKit
- whisper.cpp (CPU, used for the benchmark and Fallback B): https://github.com/ggerganov/whisper.cpp
- Apple Translation framework: https://developer.apple.com/documentation/translation
- Apple ReplayKit: https://developer.apple.com/documentation/replaykit
- iTour PC app (reference product): https://www.itourtranslator.com/pages/itour-chat-translation-pc
- Benchmark raw logs: `wa-translator/SPIKE-FINDINGS.md`
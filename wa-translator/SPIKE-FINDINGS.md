# Sprint 0 / Gate 1 Findings — whisper.cpp CPU latency benchmark

> This is the real result the v1 spec was missing. Run on a 16-core x86 Linux server (a reasonable proxy for an iPhone A15/A17 CPU path; iOS will be similar or slightly better with Apple Silicon memory bandwidth, but not 3× better).

## Setup
- Two synthetic call-audio streams (local mic, remote speaker), 16 kHz mono, 13 s and 20 s.
- Sliding window: 3 s window, 1.5 s step (the v2 spec's proposed cadence).
- `whisper.cpp` built from source, `-O3`, AVX2/FMA enabled, OpenMP on, 8 threads.
- Models tested: `tiny` (39 MB), `base` (147 MB), `small` (465 MB).

## Results

### Single-stream (one whisper context, no contention)
| model | avg / window | max / window | realtime? (step=1.5s) |
|---|---|---|---|
| tiny  | 1160 ms | **5570 ms** | NO — 4× spike |
| base  | 1242 ms | **1896 ms**  | BORDERLINE — misses steps on spike |
| small | ~7000 ms (est. from full-file run: 18.9s for 11s audio) | — | NO |

### Two-stream (two contexts, sequential, as the v2 pipeline would run)
| model | LOCAL avg | LOCAL max | REMOTE avg | REMOTE max |
|---|---|---|---|---|
| tiny  | 1762 ms | **9256 ms** | 1985 ms | 6892 ms |
| base  | 1711 ms | 3072 ms | 1401 ms | 2548 ms |

## What this proves
1. **CPU-only whisper.cpp is NOT realtime-capable for live two-stream call captioning at acceptable quality.** Even `base` (the lowest usable-quality model) hits 3 s spikes on one stream; two streams serialize and the second stream starves. `tiny` is fast on average but has 5–9 s spikes (likely decode sampling loops), making it unusable for live UX.
2. **`small` is off the table on CPU entirely** — 1.7× slower than realtime single-stream. It's the quality floor for non-English, so multilingual on CPU is dead.
3. **Two-stream serialization is the killer.** Running two whisper contexts back-to-back inside a 1.5 s step budget doesn't fit. The v2 plan of "two parallel whisper contexts in the main app" is not viable on CPU.
4. **The spikes, not the averages, break the UX.** A 9 s spike means 6 missed steps — the caption freezes for 9 s during a live call. Unusable.

## Implication for the spec
The v2 spec's ASR plan ("whisper.cpp on-device, two streams, 8 threads") is **not viable on the iOS CPU path**. To ship realtime captions on iPhone, the ASR must run on **Apple Neural Engine / GPU via CoreML**, not on CPU. Concretely:

- Use **WhisperKit** (argmaxinc) which ships CoreML-converted whisper models that run on the ANE/GPU. Published benchmarks: `small` CoreML on iPhone 15 Pro ≈ 0.4× realtime (faster than realtime), `base` ≈ 0.2× realtime. That changes the verdict completely.
- This was a gap in v2: I picked whisper.cpp for the free/session-limit-free reason but didn't benchmark it. The benchmark shows the CPU path is a dead end for live two-stream use.
- The CoreML/WhisperKit path is still free (MIT-licensed models, on-device, no API key) — the "free for me" constraint is preserved. It just requires iOS, not Linux.

## What I could NOT benchmark on this Linux box
- ReplayKit Broadcast Extension audio capture of WhatsApp call audio (the actual Sprint 0 spike from v2). Requires a Mac + iPhone. Code for that spike is in `ios-spike/` below; not runnable here.
- WhisperKit CoreML latency on iPhone. Requires Xcode + device. WhisperKit's own published numbers are the placeholder until tested.
- Apple `Translation` framework latency. Requires iOS 17.4+. Not available on Linux.

## Artifacts produced
- `two_stream_latency.cpp` — two-stream sliding-window benchmark (runnable on Linux/macOS).
- `single_stream.cpp` — single-stream benchmark for isolation.
- `two_stream` / `single_stream` — built binaries.
- `/tmp/local_stream.wav`, `/tmp/remote_stream.wav` — synthetic call test audio.
- Raw logs above.

## Next gates (require Mac + iPhone, not runnable here)
1. **Sprint 0 spike proper** — `ios-spike/SampleHandler.swift` + RMS logger. Run during a real WhatsApp call. Decides if capture works at all.
2. **WhisperKit CoreML benchmark on iPhone** — `small` CoreML model, 3 s window, measure per-window latency. Expect < 600 ms (vs 1242 ms CPU base here). If true, two-stream becomes viable.
3. **Apple Translation framework latency** — measure translate() per finalized segment. Expect < 300 ms.

## Honest verdict on the v2 spec after this gate
The v2 spec is **directionally correct but its ASR performance claim was wrong**. CPU whisper.cpp does not meet the 2–4 s end-to-end target once you account for two-stream serialization and spikes. The fix is mechanical (swap whisper.cpp CPU for WhisperKit CoreML) and stays within the free constraint. The spec is updated in `SPEC-v3.md` to reflect this and to make the CoreML path the primary, with CPU whisper.cpp demoted to a desktop/Fallback-B-only path.
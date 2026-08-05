# wa-translator — what's actually built

> Status after Sprint 0 Gates 1, 1b, 1c. Everything here is runnable on this Linux box. iOS/Windows hardware gates are staged but not runnable here.

## Runnable now (Linux)
- `two_stream_latency.cpp` + `two_stream` — whisper.cpp two-stream ASR benchmark. Gate 1.
- `single_stream.cpp` + `single_stream` — whisper.cpp single-stream. Gate 1 baseline.
- `mt_latency_ct2.py` — CTranslate2 int8 OPUS-MT benchmark. Gate 1b.
- `mt_latency_benchmark.py` — raw torch MarianMT (10x slower, comparison).
- `moonshine_bench.py` — Moonshine small/medium-streaming ASR benchmark. Gate 1c.
- `moonshine_two_stream.py` — Moonshine one-transcriber-two-streams test. Gate 1c addendum (the v2 killer, retested).
- `caption_filter_test.py` + `caption_filter_test.cpp` — 14/14 pass in both Python and C++. Real repetition-loop data from Gates 1/1b/1c.

## Portable (C++ header, ships to iOS + Windows)
- `caption_filter.h` — single-header, no deps. Loop detector (n-gram freq, non-adjacent), blank-token, dedup (Levenshtein), length cap. 14/14 tests pass.

## Staged, not runnable here (need Mac+iPhone / Windows)
- `ios-spike/SampleHandler.swift`, `ios-spike/WASpikeApp.swift` — ReplayKit capture spike. Gate 2.
- `windows/capture/WASAPILoopback.cpp` — WASAPI loopback capture skeleton. Windows capture is solved (unlike iOS Gate 2 risk).
- `windows/overlay/TopmostCaptionWindow.cpp` — topmost layered overlay skeleton. Windows overlay is easier than iOS PiP.

## Cached (not committed, large)
- `whisper.cpp/models/ggml-{tiny,base,small}.bin` — whisper models.
- `~/.cache/moonshine_voice/...` — Moonshine ONNX models (medium-streaming, small-streaming).
- `mt_models/ct2-{en-es,en-de,en-zh}-int8/` — CTranslate2 OPUS-MT models.

## How to run the runnable ones
```bash
# whisper.cpp benchmarks
./two_stream /tmp/local_stream.wav /tmp/remote_stream.wav whisper.cpp/models/ggml-base.bin
./single_stream /tmp/remote_stream.wav whisper.cpp/models/ggml-tiny.bin

# MT benchmark (first run downloads + converts models, ~1-2 GB)
python3 mt_latency_ct2.py

# Moonshine ASR benchmark (first run downloads models, ~250 MB)
python3 moonshine_bench.py
python3 moonshine_two_stream.py

# Caption filter (no deps)
./caption_filter_test
python3 caption_filter_test.py
```

## Specs (top-level, committed)
- `SPEC.md` (v1), `SPEC-v2.md`, `SPEC-v3.md`, `SPEC-v4.md`, `SPEC-v5.md` (current)
- `wa-translator/SPIKE-FINDINGS.md` (Gate 1 ASR), `SPIKE-FINDINGS-MT.md` (Gate 1b MT), `SPIKE-FINDINGS-MOONSHINE.md` (Gate 1c ASR)
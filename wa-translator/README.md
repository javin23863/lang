# wa-translator

**The app lives in [`windows/`](windows/README.md).** Everything else in this
directory is the Sprint-0 benchmark work that chose its models — kept because it
is the evidence behind the design, not because it runs in production.

## The app

`windows/` — bilingual video room: WebRTC video peer-to-peer, faster-whisper ASR
and CTranslate2 OPUS-MT on the host, live captions both directions. See
[`windows/README.md`](windows/README.md) to run it.

## Benchmarks that chose the models

Runnable, no GPU needed, none of it imported by the app:

- `two_stream_latency.cpp`, `single_stream.cpp` — whisper.cpp two-stream and
  single-stream ASR latency. Gate 1.
- `mt_latency_ct2.py` — CTranslate2 int8 OPUS-MT. Gate 1b. **Its recorded
  numbers are void:** the loops it attributed to the en-es model were a missing
  `</s>` on the source tokens, found and fixed in the v7 rewrite. The
  measurement stands; the conclusion drawn from it did not.
- `mt_latency_benchmark.py` — raw torch MarianMT, ~10x slower, the comparison
  that justified CTranslate2.
- `moonshine_bench.py`, `moonshine_two_stream.py` — Moonshine ASR. Gate 1c.
  Moonshine lost to faster-whisper for this app because its catalog has no
  streaming Spanish model, only a non-streaming `BASE`.

## Portable caption filter

- `caption_filter.h` — single-header C++, no dependencies. Loop detector
  (n-gram frequency, non-adjacent), blank-token, dedup (Levenshtein), length
  cap.
- `caption_filter_test.cpp` / `caption_filter_test.py` — 14/14 in both
  languages, against real repetition-loop output captured during the gates.

The Python port in `windows/mt_ct2.py` is the copy the app actually uses; the
two are kept behaviourally identical by the shared test cases.

## Test fixtures

`test-audio/{en,es}.wav` — 16 kHz mono, generated once with Moonshine's TTS.
The Spanish clip is what the whisper hallucination regression is pinned to; see
`windows/README.md` for how to regenerate them.

## Superseded

`ios-spike/` — ReplayKit capture spike for the original iOS design (Gate 2,
never built out). The Windows WASAPI-loopback and topmost-overlay skeletons that
used to sit beside it were deleted in the v7 rewrite: they belonged to a
local-overlay architecture the browser room replaced, and the host app that
drove them called server endpoints that no longer exist. Recover from git
history if the "translate a call playing on this PC" idea comes back.

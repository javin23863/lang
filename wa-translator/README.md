# wa-translator

The shared phone client lives in [`windows/static/`](windows/static/). The local
development adapter is documented in [`windows/`](windows/README.md); the
production beta uses [`cloudflare/`](cloudflare/DEPLOYMENT.md) for room state and
`modal_app.py` for authenticated compute. The remaining top-level files are the
Sprint-0 benchmark evidence that chose the models.

## The app

`capabilities.json` — the shared 100-base-Language / 122-Locale capability
catalog. It distinguishes six release-tested live-speech Languages from 100
M2M100 text Languages, and four enabled TTS Languages / nine exact profiles.
A Locale does not imply a distinct MT or ASR model.

`windows/` — local multilingual video-room adapter: WebRTC video peer-to-peer,
faster-whisper ASR and the same revision-pinned M2M100 CTranslate2 contract.
It remains captions-only for TTS. See [`windows/README.md`](windows/README.md)
to run it.

`cloudflare/` + `modal_app.py` — signed 24-hour rooms, one deterministic Durable
Object per room, hibernating browser sockets, dynamic TURN, unique-target
caption fanout and independently reconnectable Modal streams. The one-L4
production lane uses M2M100 and only catalog-declared Kokoro profiles. See
[`../CLOUD-ARCHITECTURE.md`](../CLOUD-ARCHITECTURE.md).

## Benchmarks that chose the models

Runnable, no GPU needed, none of it imported by the app:

- `two_stream_latency.cpp`, `single_stream.cpp` — whisper.cpp two-stream and
  single-stream ASR latency. Gate 1.
- `mt_latency_ct2.py` — historical CTranslate2 int8 OPUS-MT experiment. It is
  not the shipping MT path and its pairwise findings must not be used as M2M100
  quality or latency evidence.
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

The Python port in `windows/mt_ct2.py` is the shipping M2M100 adapter. It keeps
the caption filter/dedup behavior while using official source-language tokens
and target prefixes. See [`MULTILINGUAL-SOURCES.md`](MULTILINGUAL-SOURCES.md)
for immutable anchors, licenses and quality limits.

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

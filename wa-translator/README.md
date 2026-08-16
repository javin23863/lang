# wa-translator

The shared phone client lives in [`windows/static/`](windows/static/). The local
development adapter is documented in [`windows/`](windows/README.md); the
production beta uses [`cloudflare/`](cloudflare/DEPLOYMENT.md) for room state and
`modal_app.py` for authenticated compute. The remaining top-level files are the
deployment checks and the Sprint-0 findings that chose the models.

## The app

`capabilities.json` — the shared 100-text-Language / 122-Locale capability
catalog. The free Whisper→M2M100 intersection exposes 84 microphone-language
candidates through 106 regional Locale profiles; six exercised Languages are
marked `Tested` and the rest `Preview`. Voice output combines exact-language
device/browser voices with six included TTS Languages / thirteen pinned cloud
profiles. A Locale does not imply a distinct MT or ASR model.

`windows/` — local multilingual UI/protocol adapter. With explicitly
pre-provisioned ASR/M2M artifacts it can exercise the same revision-pinned
contract; by default it makes no model download or conversion and advertises
caption compute as unavailable. It remains captions-only for TTS. See
[`windows/README.md`](windows/README.md) to run it.

`cloudflare/` + `modal_app.py` — signed 24-hour rooms, one deterministic Durable
Object per room, hibernating browser sockets, dynamic TURN, unique-target
caption fanout and independently reconnectable Modal streams. The one-L4
production lane uses M2M100 and only catalog-declared Kokoro profiles. See
[`../CLOUD-ARCHITECTURE.md`](../CLOUD-ARCHITECTURE.md).

## Benchmarks that chose the models

The Sprint-0 benchmark programs (whisper.cpp two-stream/single-stream ASR
latency, the CTranslate2 int8 and raw-torch MarianMT MT comparisons, the
Moonshine ASR runs) were deleted once their verdicts had shipped: nothing in the
app imported them and none of them had been re-run since. Their numbers and the
decisions they bought are the receipts, and those stay:
[`SPIKE-FINDINGS.md`](SPIKE-FINDINGS.md), [`SPIKE-FINDINGS-MT.md`](SPIKE-FINDINGS-MT.md),
[`SPIKE-FINDINGS-MOONSHINE.md`](SPIKE-FINDINGS-MOONSHINE.md). Recover the
programs from git history if a gate has to be re-run. The CTranslate2 OPUS-MT
experiment in particular is *not* the shipping MT path — its pairwise findings
must never be used as M2M100 quality or latency evidence.

The portable single-header C++ caption filter and its two test ports went the
same way; `windows/mt_ct2.py` is the one that ships.

## The shipping MT adapter

The Python port in `windows/mt_ct2.py` is the shipping M2M100 adapter. It keeps
the caption filter/dedup behavior while using official source-language tokens
and target prefixes. See [`MULTILINGUAL-SOURCES.md`](MULTILINGUAL-SOURCES.md)
for immutable anchors, licenses and quality limits.

## Test fixtures

`test-audio/{en,es}.wav` — 16 kHz mono, generated once with Moonshine's TTS.
The Spanish clip is what the whisper hallucination regression is pinned to; see
`windows/README.md` for how to regenerate them.

## Superseded

The ReplayKit capture spike for the original iOS design (Gate 2, never built
out, never run — it needed a Mac and an iPhone) has been deleted, as were the
Windows WASAPI-loopback and topmost-overlay skeletons beside it in the v7
rewrite: they belonged to a local-overlay architecture the browser room
replaced, and the host app that drove them called server endpoints that no
longer exist. [`SPIKE-FINDINGS.md`](SPIKE-FINDINGS.md) still describes the
spike. Recover the code from git history if the "translate a call playing on
this PC" idea comes back.

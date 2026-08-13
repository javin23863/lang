# Cloud caption-room acceptance receipts

Status snapshot: **2026-08-13 13:14 +07:00**. A “live automated pass” below
means the deployed `workers.dev` room was exercised through its public browser
interfaces. It is not the human-audible receipt required by A11.

| Row | Status | Receipt or remaining requirement |
|---|---|---|
| A1 | Live automated pass | Public two-client Chrome checks kept translated voice off by default while the natural WebRTC call remained connected and audible-state-unmuted. |
| A2 | Live automated pass | Voice remained a per-device choice; captions persisted with voice both off and on. The language gate now explains that translated voice is incoming-only. |
| A3 | Live automated pass | The no-stub bilingual run received and played three English and three Spanish Kokoro WAVs. All six were 24 kHz mono PCM, longer than 1.9 seconds, and non-silent; exact hashes are below. |
| A4 | Live automated pass | Public browser lifecycle checks proved pre-play natural-audio mute and restoration on TTS failure, watchdog, reconnect, and peer leave. |
| A5 | Live automated pass | The real acceptance path used browser microphone capture through `AudioWorkletNode` while the WebRTC sender remained live. Mic-off/pause flush and translated-playback ASR suppression remain covered by red-capable tests. |
| A6 | Live automated pass | Six alternating real English/Spanish utterances traversed browser microphone → Worker → Modal ASR/MT → receiving-browser captions with all semantic assertions passing. Exact model output is below. |
| A7 | Offline security pass plus live auth check | Worker tests cover forged/expired/cross-room/origin/body/frame/rate boundaries. Worker health is public; unauthenticated Modal health remains fail-closed with HTTP 401. |
| A8 | **Partial live** | The public room stayed healthy for a 140.1-second bilingual conversation and recovered both clients after a 35-second browser freeze. A live Modal replacement during an observed natural WebRTC call and an explicit Windows-host-off receipt are still required. |
| A9 | **Unmet relay receipt** | Dynamic TURN and refresh contracts pass offline, but no Cloudflare Realtime subscription or TURN secrets were provisioned. The live run selected direct host↔host UDP; no relay claim is made. |
| A10 | Live automated pass | The explicit role gate rendered at 360×780 without horizontal overflow; screenshot hash and producing command are below. |
| A11 | **Unmet human** | Real returned audio was decoded, played, copied from the exact playing Blob URL, and independently re-transcribed. Automation still cannot establish what a person heard in the Codex in-app browser. |
| A12 | Live configuration pass | Pinned CUDA/runtime checks, one L4/max-one-container deployment, four stream inputs plus one bounded TTS input, scale-to-zero, persistent model cache, and one hibernating room Durable Object remain asserted by configuration tests. |

Never change A8, A9, or A11 to pass without the remaining live receipts in
`DEPLOYMENT.md`.

## Current deployment

- Worker creator URL: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`
- Worker deployment `344cfa3e-6581-4b15-acd3-a12f8f61bf8b`, version
  `50d44efa-4f4e-4081-a147-f6107c5d37d3`, deployed from runtime source commit
  `87b0e6c` (`fix: keep bilingual rooms alive and explicit`).
- Modal URL: `https://m2747076--spoken-translation-compute-web.modal.run`, app
  `ap-BGN0rYSJePL3mDbezdmZOe`; this wave did not replace the Modal deployment.
- Cloudflare currently has no `TURN_KEY_ID` or `TURN_API_TOKEN` secret. The
  billing/subscription surface was not authorized, so `/api/turn` remains
  fail-closed and A9 remains unmet.

## Real public bilingual conversation

The acceptance harness launched two independent Chrome processes against one
new signed room. Each device explicitly selected its own language before the
WebSocket joined. Six revision-pinned Kokoro utterances entered Chrome as fake
microphone hardware and then used the page's real `getUserMedia`,
`AudioWorkletNode`, Worker WebSocket, Modal ASR/MT, caption handler, `/tts`
request, and audio playback. It did not call the caption handler directly,
replace `fetch`, or return a silent stub.

| Turn | Speaker model output | Receiving device model output | Semantic result |
|---|---|---|---|
| EN 1 | `Hello Maria, how are you today?` | Spanish: `Hola María, ¿cómo estás hoy?` | Pass |
| ES 1 | `Hola David, estoy muy bien, gracias.` | English: `Hi David, I'm fine, thank you.` | Pass |
| EN 2 | `Where is the train station in Madrid?` | Spanish: `¿Dónde está la estación de tren de Madrid?` | Pass |
| ES 2 | `La estación de tren está junto al hotel.` | English: `The train station is next to the hotel.` | Pass |
| EN 3 | `I need help with my reservation for tomorrow.` | Spanish: `Necesito ayuda con mi reserva para mañana.` | Pass |
| ES 3 | `Su reserva está confirmada para mañana.` | English: `Your reservation is confirmed by tomorrow.` | Pass; semantically accepted, not claimed as a perfect literal rendering |

The conversation lasted **140.1 seconds**, longer than the 90-second presence
lease. Before the lifecycle step both browsers had an open room socket, one
peer, `2 / 4 people`, and zero close events. Both selected ICE pairs were
host↔host UDP; TURN was not available.

The exact generated source fixtures were valid 24 kHz mono WAVs:

| Turn | Frames | Seconds | RMS | SHA-256 |
|---|---:|---:|---:|---|
| EN 1 | 55,200 | 2.300 | 1566.9 | `a759b0c3dad22ca823d1c67ce59dd313279a62a836e303276a3ca521d03eb79b` |
| ES 1 | 58,800 | 2.450 | 1654.9 | `b4f3f1671c32b3d6d4946ffcf4176235171de2d949b4492f66fcf5f546e32c52` |
| EN 2 | 63,000 | 2.625 | 1406.0 | `bfdc7c62e945c59a21126d99bb32537e94a4f99d79e62b732f8f394a104f91e8` |
| ES 2 | 66,000 | 2.750 | 1556.4 | `82ee9ac53efd4c5551458f3a7b623a69e492fc4f2474e9991395582385231ec0` |
| EN 3 | 73,200 | 3.050 | 1501.9 | `6f525a6a6bc98f8d48c9f001e520a4c4b14d9fc78649ae5ef40c0392343d7e4f` |
| ES 3 | 67,800 | 2.825 | 1506.9 | `09b450b8b8f72712d79704bebff3d2606db9ac9cb2c712b601b9d94ae014e3b7` |

## Production translated-voice receipts

The harness observed only `blob:` playback sources and copied bytes from each
exact already-playing object URL. Every route below was `female`; all WAVs were
24 kHz mono, longer than 1.9 seconds, and non-silent.

| Listener / target | Spoken translation | Frames | Seconds | RMS | SHA-256 |
|---|---|---:|---:|---:|---|
| English / `en` | `Hi David, I'm fine, thank you.` | 57,600 | 2.400 | 1488.2 | `d11cbf82251da657254175e999c44298206009bcf2efde5e38e6d51508b0265e` |
| English / `en` | `The train station is next to the hotel.` | 71,400 | 2.975 | 1511.8 | `64900cfe4d37ab5757626da6d53a7e446f06c32e9a3920b771b8d06f1f4c12d2` |
| English / `en` | `Your reservation is confirmed by tomorrow.` | 75,600 | 3.150 | 1545.3 | `54ef41dabfaa2fb9e187cd00cd54a83b84961bf3c649709c6e11a630e7af9207` |
| Spanish / `es` | `Hola María, ¿cómo estás hoy?` | 48,000 | 2.000 | 1541.6 | `fdc159bf3962809c37b9e3fad09dcb3476235803cc727a7fd14cce636e880287` |
| Spanish / `es` | `¿Dónde está la estación de tren de Madrid?` | 62,400 | 2.600 | 1586.6 | `278e8cf6c961f111730af5db3fc74691222b3749a4149471a3d50e6d05e943c5` |
| Spanish / `es` | `Necesito ayuda con mi reserva para mañana.` | 70,800 | 2.950 | 1471.6 | `462d24da23abc5c98c3e037093e58a87737174989bdac3d8ede0302f86c92b6c` |

As a second language check, the deployed model independently re-transcribed
the exact played English WAV as `Hi David, I'm fine thank you.` and the exact
played Spanish WAV as `Hola María, ¿cómo estás hoy?`. This is machine evidence,
not A11.

## Background/resume and mobile lease

Chrome was frozen through DevTools for 35 seconds after the conversation. Its
browser socket closed with code 1006 and no reason, then the page's bounded
reconnect established a new participant identity. Both devices converged to an
open socket, one peer, and exact `2 / 4 people`; no manual room reset was used.
The participant heartbeat is 10 seconds and the server lease is 90 seconds, so
a genuinely abandoned joined or pre-join browser slot is removed by the first
sweep at or after 90 seconds. Explicit Leave and ordinary close release their
slots immediately.

## 360-pixel receipt

`%TEMP%\live_bilingual_role_360.png` is 360×780, 30,440 bytes, and has SHA-256
`b2e8b3dfaa6626e14b5fe0d940f20233da1f5b559be5a865df55a7f3aecd9b24`.
It shows the blocking English/Spanish role gate and the incoming-only routing
explanation before any room join.

## Producing commands

Run from the repository root in PowerShell. Audio bytes and timing can vary on
a later model/container revision, so this snapshot is not a promise of
byte-for-byte future output.

```powershell
$env:PYTHONIOENCODING='utf-8'
.\.venv\Scripts\python.exe wa-translator\windows\live_bilingual_check.py --screenshot "$env:TEMP\live_bilingual_role_360.png"
Get-FileHash -Algorithm SHA256 "$env:TEMP\live_bilingual_role_360.png"

Set-Location wa-translator\cloudflare
npm run check
npx wrangler deployments list --json
Set-Location ..\..

.\.venv\Scripts\python.exe wa-translator\probe_kokoro_tts.py --output "$env:TEMP\kokoro-probes"
.\.venv\Scripts\python.exe wa-translator\windows\probe_stream.py
.\.venv\Scripts\python.exe wa-translator\windows\browser_check.py

Set-Location wa-translator
..\.venv\Scripts\python.exe -m unittest test_modal_app.py test_deployment_config.py caption_filter_test.py
Set-Location windows
..\..\.venv\Scripts\python.exe test_room.py
..\..\.venv\Scripts\python.exe -m unittest test_cloud_client.py test_live_bilingual_check.py test_tts_local.py
Set-Location ..\..
node wa-translator\windows\test_pcm_worklet.cjs
git diff --check
```

The live command completed 6/6 semantic turns, 6/6 translated playbacks, both
independent acoustic-language checks, the 140.1-second stability assertion, and
the 35-second background/rejoin assertion. The final focused run passed Worker
typecheck, 21/21 Worker tests and deployment dry-run; 7/7 Modal tests; 7/7
deployment/caption configuration tests; 15/15 local-room tests; 18/18 browser,
live-receipt, and local-TTS tests; 2/2 worklet tests; and `git diff --check`.

# Cloud caption-room acceptance receipts

## Current truth — multilingual wave, 2026-08-14 (pre-deploy)

The dated entries below are historical bilingual/previous-model receipts. They
must not be read as a receipt for the revision-pinned M2M100 multilingual
implementation now in this branch. The current locally verified contract is:

- one shared catalog: 100 base text Languages, 122 Locale profiles, six
  release-tested live-speech Languages, four production TTS Languages and nine
  exact enabled Voice Profiles;
- one source ASR transcription fans out to up to three unique listener base
  Languages; same-base Locale listeners share one translation;
- M2M100 418M is pinned to `55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636` under
  MIT; its source weights/tokenizer and enabled Kokoro voices are hash-checked;
- local contract checks are green, but no deployed M2M100/voice/public-room
  receipt belongs to this new model version until the deployment verifier and
  fixed fixtures run on the AP-routed L4.

A8 remains **partial**: a real live Modal replacement during an observed
natural WebRTC call and an explicit Windows-host-off receipt are still missing.
A11 remains **unmet**: automated browser/media lifecycle tests do not prove a
person heard natural audio or a selected Voice Profile in the Codex in-app
browser. Do not upgrade either status from this document without those live
receipts.

The fixed M2M receipt corpus is
[`../multilingual_fixtures.json`](../multilingual_fixtures.json): EN↔ES,
EN→FR/DE/JA/AR, ES→FR and Spanish Locale mapping. Semantic token hints make an
observed output reviewable; they are not a native-speaker quality certificate.

---

## Historical bilingual receipts (previous deployed revision)

Status snapshot: **2026-08-13 18:18 +07:00**. A “live automated pass” below
means the deployed `workers.dev` room was exercised through its public browser
interfaces. It is not the human-audible receipt required by A11.

| Row | Status | Receipt or remaining requirement |
|---|---|---|
| A1 | Live automated pass | Public two-client Chrome checks kept translated voice off by default while the natural WebRTC call remained connected and audible-state-unmuted. |
| A2 | Live automated pass | Voice remained a per-device choice; captions persisted with voice both off and on. The language gate now explains that translated voice is incoming-only. |
| A3 | Live automated pass | The no-stub bilingual run received and played three English and three Spanish Kokoro WAVs. All six were 24 kHz mono PCM, longer than 1.9 seconds, and non-silent; exact hashes are below. |
| A4 | Live automated pass | Public browser lifecycle checks proved natural-audio mute only when translated playback begins, plus restoration on TTS failure, watchdog, reconnect, and peer leave. Local ASR pauses immediately before `play()` to prevent feedback. |
| A5 | Live automated pass | The real acceptance path used browser microphone capture through `AudioWorkletNode` while the WebRTC sender remained live. Mic-off/pause flush and translated-playback ASR suppression remain covered by red-capable tests. |
| A6 | Live automated pass | Six alternating real English/Spanish utterances traversed browser microphone → Worker → Modal ASR/MT → receiving-browser captions with all semantic assertions passing. Exact model output is below. |
| A7 | Offline security pass plus live auth check | Worker tests cover forged/expired/cross-room/origin/body/frame/rate boundaries. Worker health is public; unauthenticated Modal health remains fail-closed with HTTP 401. |
| A8 | **Partial live** | The public room stayed healthy for a 140.1-second bilingual conversation and recovered both clients after a 35-second browser freeze. A live Modal replacement during an observed natural WebRTC call and an explicit Windows-host-off receipt are still required. |
| A9 | Live relay pass | Cloudflare Realtime TURN is subscribed and the long-term key stays in Worker secrets. A public two-client app run forced relay-only ICE; both selected pairs were relay↔relay UDP and carried 640×480 video plus microphone audio. |
| A10 | Live automated pass | The explicit role gate rendered at 360×780 without horizontal overflow; screenshot hash and producing command are below. |
| A11 | **Unmet human** | Real returned audio was decoded, played, copied from the exact playing Blob URL, and independently re-transcribed. Automation still cannot establish what a person heard in the Codex in-app browser. |
| A12 | Live configuration pass | Pinned CUDA/runtime checks, one L4/max-one-container deployment, four stream inputs plus one bounded TTS input, scale-to-zero, persistent model cache, and one hibernating room Durable Object remain asserted by configuration tests. |

Never change A8 or A11 to pass without the remaining live receipts in
`DEPLOYMENT.md`.

## Current deployment

- Worker creator URL: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`
- Worker deployment `18af951a-6a11-41d9-a0b1-9aaf1a792559`, version
  `1ed41773-0ccf-42e2-98f0-9ebe2934be26`, deployed from runtime/asset source
  commit `f4376b8`. It includes the standalone host dashboard, separate
  room-bound host control, terminal room revocation, and the participant-only
  legacy redirect. It also accepts validated WebRTC signalling up to 64 KiB
  while ordinary control messages remain capped at 8 KiB, pauses local ASR
  before translated playback, and defers natural-audio mute until `playing`.
- Active Modal ingress:
  `https://m2747076--spoken-translation-compute-web-ap-south.ap-south.modal.run`.
  App `ap-BGN0rYSJePL3mDbezdmZOe` is deployed at version `v16` from compute
  source commit `474e457` (2026-08-13 17:04:50 +07:00). The deployment exposes
  one Modal Function with `max_containers=1`; `modal container list --json`
  showed one active container after the verification request.
- The previous default ingress remains available in Git and Modal version `v15`
  history for rollback reference, but is not simultaneously deployed. Its old
  URL, `https://m2747076--spoken-translation-compute-web.modal.run`, returned
  HTTP 404 after v16 deployed. The active AP endpoint returned 401 without its
  Worker-held bearer, and a joined participant's fixed EN→ES request through
  the Worker returned a valid 24 kHz WAV in 25.875 seconds from cold.
- Cloudflare Realtime TURN application `spoken-translation-room` is active.
  `TURN_KEY_ID` and `TURN_API_TOKEN` exist only as encrypted Worker secrets;
  no long-term key is in Git, the browser client, this receipt, or command logs.

## 2026-08-13 latency remediation

Kokoro now moves its supplied `KModel` to the deployed CUDA device and calls
`eval()` before constructing `KPipeline`; production startup logged
`device=cuda`. The Modal image also pins the CUDA 12 cuDNN runtime used by both
Kokoro and CTranslate2. Authenticated room-stream startup launches one bounded,
single-flight preload that initializes ASR/MT and then representative English
and Spanish TTS without blocking the WebSocket. Scale-to-zero remains enabled
(`min_containers=0`, 60-second scale-down); no continuously warm L4 was added.

The Worker streams an upstream WAV only after checking a present in-range
`Content-Length`, `audio/wav`, and a `RIFF` prefix, and its counting stream
rejects truncation. The browser still creates the playback Blob after the full
response, but natural peer audio is muted only when translated playback
actually enters `playing`, so a cold translation no longer creates a silent
call. Full PCM-to-browser streaming was not added because AP ingress met the
warm final-to-playback target without that larger change.

Public fixed-phrase `/tts` samples after prewarming were, in seconds:

| Direction | Samples | Result |
|---|---|---|
| EN→ES | 1.812, 1.313, 0.828 | 3/3 at or below 2.0 s |
| ES→EN | 1.250, 1.062, 1.657 | 3/3 at or below 2.0 s |

The first strict AP browser run before caption-model preload passed all five
warm speech-end→actual-playback samples: 2.412, 2.659, 1.913, 2.722, and 2.001
seconds (sample median 2.412 s). Its first conversation turn was 7.016 seconds,
including a 5.140-second cold caption. That same run completed six correct
semantic turns, six real playbacks, 138.2 seconds with no socket closes, the
35-second lifecycle gate, and independent English/Spanish acoustic checks.

After caption-model preload and the bounded WebRTC signalling fix, a fresh
public run again completed six correct semantic turns and six actual playback
starts with both sockets stable and no close events. The strict timing gate was
narrowly red:

| Warm turn | Speech end→final | Final→playing | Speech end→playing | Result |
|---:|---:|---:|---:|---|
| 2 | 1.209 s | 1.634 s | 2.843 s | Pass |
| 3 | 1.105 s | 1.932 s | 3.037 s | **Fail by 0.037 s** |
| 4 | 1.002 s | 0.934 s | 1.936 s | Pass |
| 5 | 1.202 s | 1.718 s | 2.920 s | Pass |
| 6 | 1.210 s | 1.801 s | 3.011 s | **Fail by 0.011 s** |

The five-sample warm median was 2.920 seconds for speech-end→playing and 1.718
seconds for final→playing. Thus final→playing was 5/5 at or below 2.0 seconds,
but the required end-to-end warm voice gate was only 3/5 at or below 3.0
seconds in the latest run. The harness intentionally failed before repeating
the lifecycle and acoustic sections; those remain proven by the earlier strict
AP run, not by this final run. These are individual samples, not a claimed
population distribution.

A genuinely scale-zero, immediate first request remained about 26 seconds in
one observed cold sample. A fresh room with 15 seconds of setup overlap still
hit TTS before sequential ASR/MT/TTS preload completed and took 16.516 seconds.
The cold-first target therefore remains unmet without paid warm capacity. A
continuously warm L4 was not enabled, and no cost decision was made on the
operator's behalf.

## Live TURN relay receipt

At **2026-08-13 13:44 +07:00**, authenticated `GET /api/turn` returned HTTP
200 with two ICE-server entries, one credentialed TURN entry, `stun:`, `turn:`,
and `turns:` schemes, and a roughly one-hour expiry. The browser received only
these short-lived credentials.

`FORCE_RELAY=1` made the existing two-client browser acceptance wrap the native
`RTCPeerConnection` with `iceTransportPolicy: 'relay'` before either role
joined. Both app participants connected with one succeeded candidate pair;
each selected local and remote candidate was `relay`, protocol `udp`. Both
remote videos played at 640×480, microphone/mute and translated-voice lifecycle
checks passed, explicit Leave updated both counts, and the command ended
`browser_check PASS`.

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
.\.venv\Scripts\python.exe wa-translator\windows\latency_acceptance.py --phase warm --samples 3

Set-Location wa-translator\cloudflare
npm run check
npx wrangler deployments list --json
Set-Location ..\..

.\.venv\Scripts\python.exe wa-translator\probe_kokoro_tts.py --output "$env:TEMP\kokoro-probes"
.\.venv\Scripts\python.exe wa-translator\windows\probe_stream.py
.\.venv\Scripts\python.exe wa-translator\windows\browser_check.py
$env:ROOM_BASE='https://spoken-translation-room.spoken-translation-cloudflare.workers.dev'
$env:ROOM_URL='<fresh signed room URL from POST /api/rooms>'
$env:FORCE_RELAY='1'
.\.venv\Scripts\python.exe wa-translator\windows\browser_check.py

Set-Location wa-translator
..\.venv\Scripts\python.exe -m unittest test_modal_app.py test_deployment_config.py caption_filter_test.py
Set-Location windows
..\..\.venv\Scripts\python.exe test_room.py
..\..\.venv\Scripts\python.exe -m unittest test_cloud_client.py test_live_bilingual_check.py test_tts_local.py
Set-Location ..\..
node wa-translator\windows\test_pcm_worklet.cjs
.\.venv\Scripts\modal.exe app history ap-BGN0rYSJePL3mDbezdmZOe --json
git diff --check
```

The earlier strict AP live command completed 6/6 semantic turns, 6/6 translated playbacks, both
independent acoustic-language checks, the 140.1-second stability assertion, and
the 35-second background/rejoin assertion. The final local run passed Worker
typecheck, 23/23 Worker tests and deployment dry-run; 20/20 Modal,
deployment, and caption-filter tests; 15/15 local-room tests; 26/26 browser,
latency-harness, live-receipt, and local-TTS tests; and 2/2 worklet tests. The
latest public strict run remained red only at the two warm timing samples
recorded above; it is not represented as a full acceptance pass.

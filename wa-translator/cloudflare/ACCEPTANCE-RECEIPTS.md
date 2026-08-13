# Cloud caption-room acceptance receipts

Status snapshot: **2026-08-13 11:52 +07:00**. “Live automated pass” means the
deployed `workers.dev` room was exercised through its public interfaces. It is
still not the human-audible receipt required by A11.

| Row | Status | Receipt or remaining requirement |
|---|---|---|
| A1 | Live automated pass | Public two-tab Chrome check: captions-only default, remote natural audio unmuted and no translated audio started. |
| A2 | Live automated pass | Public two-tab Chrome check: enabling voice in A left B captions-only; captions remained visible in both states. |
| A3 | Live automated pass | Public room returned valid RIFF/WAV for English/Spanish female/male (4/4); browser metadata/override checks passed. Exact offline hashes remain below. |
| A4 | Live automated pass | Public browser lifecycle proved pre-play mute and restoration on TTS failure/watchdog/reconnect/peer leave. |
| A5 | Live automated pass | Public browser worklet showed ASR false→true around WAV playback while the WebRTC audio sender stayed enabled; mic-off emitted one `speech_end`. |
| A6 | Live automated pass | Public Worker→Modal path produced attributed final captions and non-empty translations for English→Spanish and Spanish→English. Modal queue tests cover latest-wins partials and retained finals. |
| A7 | Offline security pass plus live auth check | Worker security suites cover forged/expired/cross-room/origin/body/frame/rate boundaries. Public unauthenticated Modal health returned 401; Worker health returned 200. |
| A8 | **Partial live** | Permanent Worker/Modal URLs, public health, room creation and both cold caption directions pass. Still needs a Modal replacement while an active natural WebRTC call is observed and an explicit Windows-host-off receipt. |
| A9 | **Unmet relay receipt** | Dynamic short-lived TURN config, pre-expiry refresh and peer ICE-restart contracts pass; the long-term secret is server-only. Needs selected `relay` candidate-pair browser receipt. |
| A10 | Live automated pass | Public room at 360 CSS pixels exposed all eight controls, including Leave, without overflow; screenshot: `%TEMP%\\room_check_360.png`. |
| A11 | **Unmet human** | Automation decoded and played audio but cannot satisfy human-audible Codex in-app-browser acceptance. |
| A12 | Live configuration pass | The deployed image passed its pinned CUDA-library load gate; one L4/max-one-container/four stream inputs plus one bounded TTS input/scale-zero/Volume and one hibernating DO remain asserted in configuration. |

Exact final command counts and the current CLI authentication result belong in
the implementation handoff. Never change A8, A9 or A11 to pass without their
remaining live receipts described in `DEPLOYMENT.md`.

## Fresh live deployment receipt

- Worker: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`,
  current version `c8d7368b-cf1d-4dc0-9815-43ec5fa0ea2f`, deployment
  `ab6fdce9-f622-4819-b4b2-404d32c60513`; public `/health` returned HTTP 200
  with `status=ok`.
- Modal: `https://m2747076--spoken-translation-compute-web.modal.run`, app
  `ap-BGN0rYSJePL3mDbezdmZOe`; unauthenticated `/health` returned HTTP 401.
- A bounded public two-participant probe joined two sockets, sent the checked-in
  English and Spanish fixtures, observed two attributed finals with both target
  translations, and received valid RIFF/WAV responses from all four TTS routes.
  It printed no transcript or credential.
- With `ROOM_URL` set to the live private invite and UTF-8 console mode,
  `browser_check.py` ended in `browser_check PASS`: WebRTC connected in both
  tabs with three succeeded candidate pairs per tab and 640×480 remote video.
  The visible Leave control immediately removed the peer and changed the
  survivor/leaver displays to 1/4 and 0/4. This is automated evidence only,
  not A11.
- Public WebSocket lifecycle probe: explicit Leave emitted `peer_leave` and
  admitted a replacement in 718 ms; ordinary close admitted one in 625 ms;
  TCP abort admitted one in 1.687 s. Four sockets left open but silent were
  replaced after 30.97 s with an empty peer list and count 1. The advertised
  server lease was exactly 30,000 ms. A join at or after expiry sweeps
  immediately; an already-active room observes abandonment on its next
  10-second heartbeat.
- `Get-FileHash -Algorithm SHA256 "$env:TEMP\\room_check_360.png"` produced
  `a2d133dc96d8b7bda74b0e1b5992652c65ee3e1b8ce980bf87ae04b6ac87fff0`
  for the 22,404-byte live 360×800 screenshot.
- Cloudflare currently has no `TURN_KEY_ID` or `TURN_API_TOKEN` secret. Wrangler
  OAuth lacks Calls Write, so `/api/turn` remains fail-closed and A9 is unmet.

## Durable offline receipt commands

Run from the repository root in PowerShell. These commands produce the values
below; the snapshot is not a promise that a different host will have identical
latency or audio bytes.

```powershell
.\.venv\Scripts\python.exe wa-translator\probe_kokoro_tts.py --output "$env:TEMP\kokoro-probes"
.\.venv\Scripts\python.exe wa-translator\windows\probe_stream.py
.\.venv\Scripts\python.exe wa-translator\windows\browser_check.py
Get-FileHash -Algorithm SHA256 "$env:TEMP\room_check_360.png"
```

2026-08-13 Kokoro snapshot:

- `en-female`: 123644 bytes, SHA-256 `226d13812bde76f95eab13fa1b284428352b26e96a3024b41aca467d7f9490dd`
- `en-male`: 136844 bytes, SHA-256 `a25f888cc84dc4a3d013ce9857dbb3aa6a952253fa774f6b06e57755a6c42b0e`
- `es-female`: 105644 bytes, SHA-256 `7b480cc44f3b202f0e3a71b2e01c92c784b9836cb6bcffc2cb66cb61342b5b53`
- `es-male`: 109244 bytes, SHA-256 `cd42570d87346f6dffc3aee4beccdfb6adf1e80889652ae96ffda0302242a6ab`

2026-08-13 stream snapshot: English→Spanish final at 4.97 seconds after
speech onset; Spanish→English final at 5.36 seconds. The 360×800 browser
screenshot SHA-256 was
`e64136694a6c0be3052569768b98f2f228977582d81b6d21e7a7411c010e0f5d`.

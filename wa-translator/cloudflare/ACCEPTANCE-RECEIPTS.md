# Cloud caption-room acceptance receipts

Status snapshot: **2026-08-13**. “Offline pass” means the implementation was
proved against the public local interface or a true network seam stub. It is
not a live Cloudflare/Modal receipt.

| Row | Status | Receipt or remaining requirement |
|---|---|---|
| A1 | Offline pass | Two-tab Chrome check: captions-only default, remote natural audio unmuted, caption rendered, zero TTS starts. |
| A2 | Offline pass | Two-tab Chrome check: enabling voice in A left B captions-only; captions rendered in both states. |
| A3 | Offline pass | Deterministic metadata/override tests plus four real pinned Kokoro WAV probes; all RIFF/24 kHz. Exact producing command and hashes are below. |
| A4 | Offline pass | Browser lifecycle proved pre-play mute and restoration on disable/TTS failure/watchdog/reconnect/peer leave. |
| A5 | Offline pass | Browser worklet receipt showed ASR false→true around real WAV playback while the WebRTC audio sender stayed enabled. ASR pause and mic-off each sent exactly one `speech_end` before capture stopped; resume sent none. |
| A6 | Offline pass | Modal public WebSocket smoke proves final FIFO and partial latest-wins. The public local room probe produced attributed finals and translations in both directions; producing command and dated latency snapshot are below. |
| A7 | Offline pass | Worker public fetch/WebSocket security tests cover forged/expired/cross-room/origin/body/frame boundaries, valid-frame PCM flooding, live-participant TTS binding and the 12/minute room quota; Modal rejects missing/bad bearer. Local room creation rejects absent/cross-site Origin. |
| A8 | **Unmet live** | Offline deterministic-DO/process-replacement tests pass. Needs permanent Worker URL, Modal cold-start/replacement and Windows-host-off receipt. |
| A9 | **Unmet relay receipt** | Dynamic short-lived TURN config, pre-expiry refresh and peer ICE-restart contracts pass; the long-term secret is server-only. Needs selected `relay` candidate-pair browser receipt. |
| A10 | Offline pass | 360 CSS-pixel assertion passed with seven controls and no overflow; screenshot: `%TEMP%\\room_check_360.png`. |
| A11 | **Unmet human** | Automation decoded and played audio but cannot satisfy human-audible Codex in-app-browser acceptance. |
| A12 | Offline configuration pass | One L4/max-one-container/four stream inputs plus one bounded TTS input/scale-zero/Volume and one hibernating DO are asserted; operational ceilings are in `DEPLOYMENT.md`. |

Exact final command counts and the current CLI authentication result belong in
the implementation handoff. Never change A8, A9 or A11 to pass without the
live receipts described in `DEPLOYMENT.md`.

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

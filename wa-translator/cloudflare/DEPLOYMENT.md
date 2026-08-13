# Cloud room deployment

This is the production shape described in `CLOUD-ARCHITECTURE.md`: Cloudflare
owns the room and Modal supplies independent authenticated compute. A
`workers.dev` URL is the intended beta endpoint. There is no database, account
system, native wrapper or custom domain.

## Fixed beta ceilings

- The catalog declares **100 M2M100 base text languages**, **122 BCP-47 locale
  profiles**, and **six release-tested live-speech base languages**: Arabic,
  German, English, Spanish, French, and Japanese. A locale maps to one base
  language; it never claims a regional ASR or MT model or dialect-specific
  quality. Unknown/mismatched profiles fail closed.
- Each browser explicitly chooses its speaking locale before it joins. One ASR
  transcript fans out once to the unique base languages of current listeners
  (at most three); Spanish regional listeners share one Spanish translation.
  Translated voice is incoming-only.
- The production runtime exposes only exact pinned Kokoro profiles reachable
  from release live-speech locales: American/British English, Spanish, and
  French female. Japanese has documented upstream voices but is captions-only
  until its dictionary/runtime dependency is pinned and license-reviewed;
  Arabic and German are also captions-only. No wrong-language voice fallback
  is permitted.
- One L4 Modal container has four stream slots reserved for global captions, shared by
  every room, plus one TTS slot. A room still admits up to four participants,
  but a fifth active speaker across rooms receives an explicit
  `caption_status` capacity message rather than silently dropping PCM; natural
  WebRTC audio/video remain live while the Worker retries. A second
  simultaneous TTS request fails fast instead of taking a stream slot. The
  active deployment exposes only the AP-routed `web_ap_south` Modal Function;
  per-function `max_containers=1` is therefore also the app-wide L4 ceiling.
  The container has a 60-second idle scale-down window and scale-to-zero. The
  named Modal Volume is the persistent model cache. A cold start still
  initializes models even when their files are cached, so first-caption and
  first-voice latency will be higher. The prior default-routed implementation
  remains in Git and Modal deployment history for rollback, but must not be
  deployed alongside the AP function because each Function owns its own
  container ceiling.
- A participant link is a deliberately replayable HMAC bearer for exactly 24 hours.
  Creation separately returns a domain-separated, room-bound host
  bearer to the same-origin dashboard. It is stored only on that host device;
  it is never included in the participant URL. The host may inspect or revoke
  its room through `/api/room-control`; a missing, forged, cross-origin or
  expired host bearer fails closed.
- The Durable Object stores expiry and, after revocation, a closed tombstone
  through that expiry. It sends `room_closed` and close code 4001 to current
  sockets, cancels compute, and refuses later participant page, preflight and
  WebSocket access. Presence and explicitly selected voice profile and the small per-room
  TTS quota counters otherwise live in hibernation
  attachments; captions and media are never stored.
  Ordinary memory is disposable. An active outbound Modal WebSocket prevents
  Durable Object hibernation while that compute stream is open.
- The client renews its presence lease every 10 seconds. Leave and a delivered
  WebSocket close free a slot immediately. If a phone disappears without a
  close handshake, another live heartbeat or the next join removes it once the
  90-second lease has elapsed; it no longer counts toward the four-person cap.
  An unjoined socket also stops counting toward the eight-pending-socket guard
  after that same lease.
- A Modal process restart loses decoder/endpointer state by design. Cloudflare
  reconnects each participant's compute stream independently and drops PCM
  while reconnecting instead of buffering stale speech. The browser's natural
  peer-to-peer WebRTC call does not depend on Modal and stays live.
- Short utterance quality is a known ceiling. Whisper can invent filler on
  sub-second speech, so partial decoding waits for 0.8 seconds and Silero gates
  every decode. Very short Kokoro phrases can sound less natural than complete
  sentences. A synthetic voice profile is explicitly selected, never inferred
  from identity, gender detection, cloning or biometric data.

Protocol limits are fail-closed: 8 KiB ordinary browser/compute control frames,
up to 64 KiB only for validated WebRTC signalling, 32,000-byte PCM frames,
300-character captions and TTS text, 2 KiB TTS request bodies, 4 MiB TTS WAV
responses, eight pending browser sockets, four joined
participants, a 40,000-byte/second microphone rate with a 64,000-byte burst,
12 TTS phrases per room per 60 seconds, an eight-second maximum compute
reconnect delay, and TURN TTL clamped to 60–172,800 seconds (configured to
3,600 seconds). Presence heartbeats run every 10 seconds with a 90-second
lease. Browsers refresh TURN one minute before expiry, replace every peer
connection's ICE configuration, and restart ICE.

## Dependency and license gate

`modal-runtime-requirements.txt` is a Linux/Python 3.11 lock of all 137 resolved
packages with hashes. The Modal image installs it with `--require-hashes`.
The lock includes explicit CUDA 12 cuBLAS/cuDNN compatibility libraries for
CTranslate2, and the image build loads both shared objects before deployment.
Model downloads use immutable Hugging Face revisions; the M2M100 source
artifacts, Kokoro main weight, and every enabled Kokoro voice artifact are
checked against pinned SHA-256 values before loading. Review
`../THIRD-PARTY-NOTICES.md` and `../licenses/Apache-2.0.txt` before a release.

Regenerate the lock only as an audited dependency change:

```powershell
uv pip compile --python 3.11 --python-platform x86_64-manylinux_2_28 --generate-hashes `
  --output-file wa-translator/modal-runtime-requirements.txt `
  wa-translator/modal-runtime-requirements.in
```

## Account grants and secrets

No secret value belongs in git, a URL, browser code or logs. Before deployment:

1. Authenticate the pinned Modal CLI and Wrangler interactively. Verify with
   `modal token info` and `npx wrangler whoami`.
2. Create the Modal named secret `spoken-translation-modal` containing only
   `MODAL_SHARED_SECRET`. Generate at least 32 random bytes. Put the same value
   into Cloudflare with `npx wrangler secret put MODAL_SHARED_SECRET`.
3. Put `ROOM_SIGNING_KEY` (at least 32 random bytes), `TURN_KEY_ID`, and
   `TURN_API_TOKEN` into Cloudflare secrets. The TURN long-term API token must
   never be returned to the browser.
4. Deploy Modal with `modal deploy wa-translator/modal_app.py`. On Windows,
   set `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` for the CLI process. Record
   the ASGI HTTPS URL. Put its `https://.../stream` and `https://.../tts` endpoints into
   Cloudflare as `MODAL_WS_URL` and `MODAL_TTS_URL` secrets.
   `MODAL_WS_URL` is deliberately HTTPS: the Worker performs an HTTP fetch with
   `Upgrade: websocket`; a `wss://` request URL is rejected as configuration.
5. From `wa-translator/cloudflare`, run `npm ci`, `npm run check`, then
   `npx wrangler deploy`. If a canonical origin is configured, set
   `PUBLIC_ORIGIN` to the exact `https://...workers.dev` origin; never use a
   wildcard. Record the deployment ID and URL printed by each CLI.

The commands above require operator grants and may incur external charges.
They are reproducible instructions. The current authenticated deployment and
its public receipts are recorded below and in
[`../../MULTILINGUAL-PRODUCT-HANDOFF.md`](../../MULTILINGUAL-PRODUCT-HANDOFF.md).

## Current deployed receipt — 2026-08-14 +07

- Worker: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`,
  version `f9976551-31df-47e7-9816-3d4e0e85fc75`, deployment transaction
  `09b15764-0806-481a-9142-484b47653ac6`, from runtime source
  `08392d818d23e486c50200b4f17cee498d5ccb25`.
- Modal: app `ap-BGN0rYSJePL3mDbezdmZOe`, version `v20`, tag `08392d8`,
  deployed at 05:54:25 +07 to
  `https://m2747076--spoken-translation-compute-web-ap-south.ap-south.modal.run`.
  It exposes one AP-routed Function with `gpu="L4"`, `max_containers=1`,
  `min_containers=0`, and a 60-second scale-down window. A post-deploy
  container listing observed exactly one running container after the model
  probe; this is not a reservation to keep it warm.
- Public `GET /health` returned `ok`; `/api/capabilities` returned no-store,
  catalog revision `2026-08-14-m2m100-55c2e61-tts3`, 100 base Languages, 122
  Locale profiles, six live-speech Languages, 100 text Languages, three enabled
  TTS Languages and seven Voice Profiles. `ja-JP` explicitly reports Voice
  unavailable rather than reaching a wrong-language or unpinned frontend.
- Actual v20 logs show Whisper CUDA/float16 and M2M100 CUDA/int8_float16 at
  revision `55c2e61bbf05`. Public enabled-route probes returned valid 24 kHz
  WAVs for Spanish, English and French. These are model/runtime receipts, not
  a native-speaker quality certification or A11 human-audibility proof.

## Live receipts required after deployment

1. The public health, catalog, one-stream model-load and enabled TTS probes
   above are complete. The remaining strict M2M semantic corpus is intentionally
   authenticated at Modal; run it only from an authorized environment holding
   `MODAL_SHARED_SECRET`, and do not expose that secret to a browser or log.
2. Replace a Modal process and show that only compute reconnects: natural
   WebRTC media stays connected and later captions resume. Do not infer this
   receipt from the offline stub replacement test.
3. Force direct ICE to fail and retain a browser `getStats()` receipt whose
   selected candidate pair uses a `relay` local candidate. Dynamic TURN config
   alone does not satisfy this gate.
4. Perform A11 in the real Codex in-app browser with two people: see video,
   hear natural audio in captions-only mode, see captions for supported routes,
   then audibly exercise only visible selected voice profiles. Automated
   playback counters do not satisfy this human-observable gate.

## Windows standalone host dashboard

The root page is a standalone PWA/Edge app-mode host dashboard. It creates one
room at a time, persists the separate host bearer only in same-device
`localStorage`, shares/copies only the participant link, visibly reports ready,
open, closed, or expired state, and asks before replacing an active room. A
host who clears that device's browser storage loses its control bearer; this is
a deliberate no-account ceiling, not participant access or media persistence.

On 2026-08-13, the checked Windows shortcut receipt was:

- `C:\Users\MSI\Desktop\Live Translator.lnk`
- target: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- arguments: `--app=https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`
- icon: `C:\Users\MSI\AppData\Local\LiveTranslator\LiveTranslator.ico,0`
- launch evidence: Edge process PID 19772 had window title `Live Translator`
  and command line
  `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`.

This proves the inspected shortcut target and a separately launched Edge app
window, not an independent visual URL read: Windows Computer Use stopped before
it could determine the current browser URL, so no further app UI action was
taken. Re-run the non-invasive shortcut-property inspection and visible
app-window check after changing its target or Edge installation.

## Cost ceiling

The cost ceiling is architectural, not a promise of zero spend: one L4
container and at most five concurrent Modal inputs (four streams plus one TTS), scale-to-zero after the
idle window, one persistent model Volume, one Durable Object per active room,
and on-demand TURN. Modal GPU/Volume, Cloudflare Durable Objects, Workers and
Realtime TURN are metered according to the actual account plan. Check current
dashboards and pricing before raising any ceiling.

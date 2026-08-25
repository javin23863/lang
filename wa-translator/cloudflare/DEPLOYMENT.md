# Cloud room deployment

This is the production shape described in `CLOUD-ARCHITECTURE.md`: Cloudflare
owns the room and Modal supplies independent authenticated compute. A
`workers.dev` URL is the current development endpoint. Accounts are OAuth-only
(no password custody) in a `UserDirectory` Durable Object holding one record per
signed-in host: profile, usage totals, and capped usage rows. There is no
conversation-history database. The Android and iPhone products are a thin
Capacitor wrapper over the same bundled room client. A bounded Durable Object
inbox retains category-only abuse reports for 30 days.

## Product invariants and compute defaults

- The catalog declares **100 M2M100 text languages**, **84 free
  Whisper→M2M100 microphone-language candidates**, and **106 selectable BCP-47
  locale profiles**. Arabic, German, English, Spanish, French, and Japanese are
  the exercised `Tested` tier; every other joinable route is marked `Preview`.
  A locale maps to one base language and never claims a regional ASR/MT model
  or dialect-specific quality. Unknown/mismatched profiles fail closed.
- Each browser explicitly chooses its speaking locale before it joins. One ASR
  transcript fans out once to the unique base languages of current listeners.
  Version 1.0 rooms admit exactly **two participants** total, so one speaker has
  at most one remote listener. Translated voice is incoming-only.
- The production runtime exposes thirteen exact pinned Kokoro profiles for
  American/British English, Spanish, French, Hindi, Italian, and Brazilian
  Portuguese. The client additionally lists exact-locale or same-base voices
  installed on the user's browser/device; those voices stay local and do not
  become server profile IDs. No wrong-language voice fallback is permitted.
- Modal uses one public L4-backed Function. Per-container admission and
  horizontal scale are separate controls. The development defaults are four
  long caption stream slots plus one shared TTS/translate short-job slot per
  container, `max_containers=1`, `min_containers=0`, a 60-second scale-down
  window, and `ap-south` routing. These are defaults, not product constants.
  Production values are resolved from validated deployment settings:
  `LINGUA_MODAL_STREAM_INPUTS`, `LINGUA_MODAL_TTS_INPUTS`,
  `LINGUA_MODAL_MAX_CONTAINERS`, `LINGUA_MODAL_MIN_CONTAINERS`,
  `LINGUA_MODAL_SCALEDOWN_WINDOW_S`, and `LINGUA_MODAL_ROUTING_REGION`.
  The stream/short-job values are baked into the image during deployment so
  the local Modal concurrency decorator and remote `InputCapacity` cannot use
  different limits. Invalid or out-of-range settings fail the deployment
  import rather than silently falling back.
- `@modal.concurrent` permits the configured stream slots plus short-job slots,
  while `target_inputs` is the stream-slot count. That leaves short-job headroom
  and gives Modal a reason to place additional load before a container has
  exhausted its long-stream reservation. `InputCapacity` remains a final
  container-local guard against a burst arriving during scale-out. A rejected
  stream gets an explicit capacity status and the Worker retries; natural
  WebRTC audio/video stay live. Short TTS/translate work fails fast instead of
  taking a long-stream slot.
- Raising `LINGUA_MODAL_MAX_CONTAINERS` changes horizontal GPU scale, not room
  size. A Lingua Relay room remains two-person regardless of the number of
  available compute containers. Do not raise per-container stream slots merely
  to increase user count; benchmark GPU latency/memory first and scale out when
  the tested per-container envelope is reached.
- The named Modal Volume is the persistent model cache. A cold start still
  initializes models even when their files are cached, so first-caption and
  first-voice latency will be higher. `min_containers=0` preserves scale-to-zero
  by default; a nonzero warm floor is an explicit cost decision.
- Authenticated `GET /health` starts the model preload, and the Worker calls it
  when a room is created and when a participant opens the invite link, so cold
  start work can begin inside the share-and-join gap. An external uptime prober
  pointed at `/health` with the shared secret will therefore spin compute; a
  prewarm failure is intentionally non-fatal and moves the cold-start cost to
  the next speaker. The host dashboard's room-control poll does not prewarm.
- A participant link is a deliberately replayable HMAC bearer for exactly 24
  hours. Creation separately returns a domain-separated, room-bound host bearer
  to the same-origin dashboard/native account session. The host-control bearer
  is stored only on that host device and is never included in the participant
  URL. A missing, forged, cross-origin or expired host bearer fails closed.
- The room Durable Object stores expiry and, after revocation, a closed tombstone
  through that expiry, plus small per-room TURN/report quota counters. It sends
  `room_closed` and close code 4001 to current sockets, cancels compute, and
  refuses later participant page, preflight and WebSocket access. Presence,
  explicitly selected voice profile, and TTS quota counters otherwise live in
  hibernation attachments. The abuse object deletes hashed per-IP counters at
  window expiry. The report inbox automatically deletes category-only reports
  after 30 days. Captions, transcripts, audio, and video are never stored.
  Ordinary memory is disposable. An active outbound Modal WebSocket prevents
  Durable Object hibernation while that compute stream is open.
- The client renews its presence lease every 10 seconds. Leave and a delivered
  WebSocket close free a slot immediately. If a phone disappears without a
  close handshake, another live heartbeat or the next join removes it once the
  90-second lease has elapsed; it no longer counts toward the two-person cap.
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
responses, eight pending browser sockets, two joined participants, a
40,000-byte/second microphone rate with a 64,000-byte burst, 12 TTS phrases per
room per 60 seconds, an eight-second maximum compute reconnect delay, and TURN
TTL clamped to 60–172,800 seconds (configured to 3,600 seconds). Presence
heartbeats run every 10 seconds with a 90-second lease. Browsers refresh TURN
one minute before expiry, replace every peer connection's ICE configuration,
and restart ICE.

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

## Account grants, compute settings, and secrets

No secret value belongs in git, a URL, browser code or logs. Before deployment:

1. Authenticate the pinned Modal CLI and Wrangler interactively. Verify with
   `modal token info` and `npx wrangler whoami`.
2. Create the Modal named secret `spoken-translation-modal` containing only
   `MODAL_SHARED_SECRET`. Generate at least 32 random bytes. Put the same value
   into Cloudflare with `npx wrangler secret put MODAL_SHARED_SECRET`.
3. Put `ROOM_SIGNING_KEY` (at least 32 random bytes), `TURN_KEY_ID`,
   `TURN_API_TOKEN`, and a separate random `MOBILE_REPORT_ADMIN_TOKEN` (at
   least 32 bytes) into Cloudflare secrets. Keep the report token in the
   operator's password manager; it is the only credential accepted by the
   private report inbox. TURN and report credentials must never be returned to
   a browser, URL, or log.
4. Resolve Modal capacity before deployment. With no environment overrides the
   source intentionally keeps the development envelope:

   ```text
   LINGUA_MODAL_STREAM_INPUTS=4
   LINGUA_MODAL_TTS_INPUTS=1
   LINGUA_MODAL_MAX_CONTAINERS=1
   LINGUA_MODAL_MIN_CONTAINERS=0
   LINGUA_MODAL_SCALEDOWN_WINDOW_S=60
   LINGUA_MODAL_ROUTING_REGION=ap-south
   ```

   `LINGUA_MODAL_STREAM_INPUTS` is bounded to 2–16,
   `LINGUA_MODAL_TTS_INPUTS` to 1–4, `LINGUA_MODAL_MAX_CONTAINERS` to 1–64,
   the warm floor cannot exceed the maximum, and scale-down is bounded to
   30–3,600 seconds. Increase these only from measured concurrency, memory,
   caption latency and cost data. A nonzero `LINGUA_MODAL_MIN_CONTAINERS` keeps
   paid GPU capacity warm.
5. Deploy Modal with `modal deploy wa-translator/modal_app.py`. On Windows, set
   `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` for the CLI process. Record the
   ASGI HTTPS URL. The established public Function name remains `web_ap_south`
   for endpoint stability even when `LINGUA_MODAL_ROUTING_REGION` is changed.
   Put its `https://.../stream` and `https://.../tts` endpoints into Cloudflare
   as `MODAL_WS_URL` and `MODAL_TTS_URL` secrets. `MODAL_WS_URL` is deliberately
   HTTPS: the Worker performs an HTTP fetch with `Upgrade: websocket`; a
   `wss://` request URL is rejected as configuration.
6. Provision sign-in. `PUBLIC_ORIGIN` is a `vars` entry in `wrangler.jsonc` and
   must equal the deployed origin exactly — `/auth/*/start` 503s without it,
   because the OAuth `redirect_uri` is pinned to it. Then, per provider,
   `npx wrangler secret put` the pair the provider console issues and register
   `<PUBLIC_ORIGIN>/auth/<provider>/callback` there:
   - Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
   - Facebook: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`.
   - Apple (required before iOS submission when third-party social login is
     offered): `APPLE_CLIENT_ID` (Services ID), `APPLE_KEY_ID`,
     `APPLE_PRIVATE_KEY` (the `.p8` contents, newlines included). The JWT issuer
     reuses `MOBILE_APPLE_TEAM_ID`.
   A provider with no secrets is absent: its `/auth/<p>/start` 404s and
   `/api/me` never offers its button. Nothing else degrades.
7. From `wa-translator/cloudflare`, run the release verification commands only
   when the development pass is complete, then deploy with Wrangler. Record the
   deployment ID and URL printed by each CLI.

The commands above require operator grants and may incur external charges.
They are reproducible instructions; they are not part of the current development
pass. Historical authenticated deployment receipts are retained below and in
[`../../MULTILINGUAL-PRODUCT-HANDOFF.md`](../../MULTILINGUAL-PRODUCT-HANDOFF.md).

## Last live deployment receipt — 2026-08-14 11:04 +07

- Worker: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`,
  version `f2c94502-82f3-4281-809f-3aed424bb25b`, from runtime source
  `b7b0fffdd41816b45cf0e1ee53893b6802d75853`, deployed at 10:55 +07. The
  deployed mobile bootstrap, legal pages, well-known association surfaces,
  category-only report path, private bounded report inbox, and moderator room
  close path are part of this version.
- Modal: app `ap-BGN0rYSJePL3mDbezdmZOe`, version `v22`, deployed at 08:00 +07 to
  `https://m2747076--spoken-translation-compute-web-ap-south.ap-south.modal.run`.
  That historical deployment exposed one AP-routed Function with `gpu="L4"`,
  `max_containers=1`, `min_containers=0`, and a 60-second scale-down window. A
  post-deploy container listing observed exactly one running container after the
  model probe; this was not a reservation to keep it warm.
- Public `GET /health` returned `ok`; `/api/capabilities` returned no-store,
  catalog revision `2026-08-14-m2m100-55c2e61-free84-tts13`, 100 base/text
  Languages, 122 Locale profiles, 84 model-pair microphone candidates, 6
  Tested Languages, 106 joinable Locale profiles, 6 included-voice Languages
  and 13 Voice Profiles. `km-KH` was a joinable `Preview` route with native-first
  label `ខ្មែរ — Khmer (Cambodia)` and no substituted included voice.
- Prior actual v20 logs showed Whisper CUDA/float16 and M2M100 CUDA/int8_float16
  at revision `55c2e61bbf05`. Public enabled-route probes returned valid 24 kHz
  WAVs for Spanish, English and French. The v22 public participant-bound route
  additionally returned valid non-silent 24 kHz WAVs for Hindi, Italian and
  Brazilian Portuguese. These are model/runtime receipts, not a native-speaker
  quality certification or human-audibility proof.
- The no-secret public mobile probe returned health 200, bootstrap 200, room
  creation 201, WebSocket welcome, report 201, private list 200, moderator close
  200, and closed-room preflight 410. `MOBILE_REPORT_ADMIN_TOKEN` was installed;
  its operator backup remains outside the repository.
- The live public two-tab browser gate passed native-name-first Khmer and Arabic
  selection, 360px/RTL layouts, WebRTC audio/video, permission revoke/regrant,
  device and included voice lifecycles, feedback protection, and room release.

## Live receipts required after deployment

1. Re-run public health, catalog, one-stream model-load, enabled TTS, and strict
   M2M semantic receipts against the exact release deployment. The semantic
   corpus is authenticated at Modal; run it only from an authorized environment
   holding `MODAL_SHARED_SECRET`, and do not expose that secret to a browser or
   log.
2. If any compute capacity setting differs from the defaults, record the
   resolved `/health` stream/TTS limits and a load receipt showing caption
   latency, GPU memory, scale-out behavior and recovery at the intended room
   concurrency. Configuration alone is not a scale receipt.
3. Replace a Modal process and show that only compute reconnects: natural
   WebRTC media stays connected and later captions resume. Do not infer this
   receipt from the offline stub replacement test.
4. Force direct ICE to fail and retain a browser `getStats()` receipt whose
   selected candidate pair uses a `relay` local candidate. Dynamic TURN config
   alone does not satisfy this gate.
5. Perform the final in-app browser/native-device call gate with two people: see
   video, hear natural audio in captions-only mode, see captions for supported
   routes, then audibly exercise only visible selected voice profiles.
   Automated playback counters do not satisfy this human-observable gate.

## Windows standalone host dashboard

The root page is a standalone PWA/Edge app-mode host dashboard. It creates one
room at a time, persists the separate host bearer only in same-device
`localStorage`, shares/copies only the participant link, visibly reports ready,
open, closed, or expired state, and asks before replacing an active room. A
host who clears that device's browser storage loses its control bearer; this is
host-control loss, not participant access or media persistence.

On 2026-08-14, the first-start repair and launch receipt was:

- source: [PR #4](https://github.com/javin23863/lang/pull/4), merged into
  `main` at `3bdbad6f92ca61678d6dc86a369ca68367437fa5`
- `C:\Users\MSI\Desktop\Live Translator.lnk`
- target: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- arguments: `--app=https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/`
- icon: `C:\Users\MSI\AppData\Local\LiveTranslator\LiveTranslator.ico,0`
- the idempotent source installer is
  `wa-translator\windows\persistent_host.ps1 -Action Install`
- the installer left exactly one translator shortcut, removed the retired
  `Live Translator Host` login task and legacy Open/Start/Stop shortcuts, and
  left no listener on development port 8791
- independent launch evidence: Edge process PID 17464 had window title
  `Lingua Relay · Private rooms` and command line
  `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/`
- Windows Computer Use visually showed the standalone dashboard with only the
  product name, device room state, and `Create private room` action; snapshot:
  `C:\Users\MSI\AppData\Local\Temp\live_translator_desktop_startup.jpg`.

The visible app window has no address bar, so the URL receipt comes from both
the inspected shortcut and the launched process command line. Re-run the
installer, shortcut-property inspection, public `/health` probe, process check,
and visible app-window snapshot after changing the target or Edge installation.

## Cost ceiling

The source default cost ceiling remains one scale-to-zero L4 container, four
caption stream slots and one shared TTS/translate short-job slot, one persistent
model Volume, one Durable Object per active room, and on-demand TURN. The actual
GPU ceiling of a release is the resolved `LINGUA_MODAL_MAX_CONTAINERS` and
`LINGUA_MODAL_MIN_CONTAINERS` deployment configuration. Modal GPU/Volume,
Cloudflare Durable Objects, Workers and Realtime TURN are metered according to
the actual account plan. Do not raise a ceiling without a matching load/cost
receipt.

# Lingua Relay cloud architecture — implementation contract

> DEVELOPMENT STATUS — August 25, 2026: source is being hardened for Android
> and iOS release. The last live deployment receipts are historical and remain
> recorded in `wa-translator/cloudflare/DEPLOYMENT.md` and
> `MULTILINGUAL-PRODUCT-HANDOFF.md`. Do not treat them as receipts for the
> current branch. Release CI, signed native builds, deployment probes, relay
> receipts, and store submission checks run only after the development pass is
> complete.

## Product boundary

Lingua Relay is a private **two-person** multilingual communication product.
The host signs in and creates one expiring room; the invited participant opens
its bearer link without an account. A room can present as voice call, text chat,
or video call, but all three surfaces use the same signed room and the same
server-enforced two-participant limit.

Inside a room:

- WebRTC carries natural microphone/camera media peer-to-peer and uses TURN only
  when direct ICE cannot connect.
- Cloud speech recognition produces phrase-level captions from microphone PCM.
- M2M100 translates captions/chat into the remote participant's base language.
- Optional translated voice speaks final translated phrases on the listener's
  device. Natural remote audio is restored immediately if that feature fails.
- Captions remain available independently of translated voice.
- Conversation audio, video, captions, translated voice, and chat text are not
  intentionally persisted as conversation history.

The capability catalog remains authoritative for which languages/locales and
voice profiles are actually selectable. Text-language count is not a claim of
verified live-microphone or translated-voice quality for every language.

## Runtime structure

```text
Host dashboard / Android / iOS
  |
  | OAuth session (host only)
  v
Cloudflare Worker
  - account/session boundary
  - room creation + signed 24-hour participant bearer
  - separate host-control bearer
  - mobile compatibility bootstrap
  - static web/native-shared assets
  - TURN credential proxy
  - abuse/report endpoints
  |
  | room ID after signature verification
  v
Cloudflare Durable Object: Room
  - exactly two joined participants
  - presence leases and WebSocket signalling
  - WebRTC signal relay
  - caption/chat fan-out
  - room-scoped TTS/report/TURN quotas
  - host close / closed tombstone
  - ephemeral compute connections
  |
  | server-authenticated compute requests
  v
Modal ASGI/L4 compute
  - Whisper ASR
  - M2M100 translation
  - optional Kokoro TTS
  - container-local admission controls
  - horizontally configurable container ceiling

Additional Durable Objects
  - AbuseGate: bounded/rate-limited counters and one-time native handoffs
  - ReportInbox: category-only abuse reports, bounded + 30-day retention
  - UserDirectory: host profile, aggregate usage, capped recent usage rows
```

Cloudflare is the permanent control plane. Modal does not own room identity,
presence, signalling, accounts, or natural WebRTC media. A Modal restart loses
only decoder/compute state; the browser call and Durable Object room survive and
the affected compute stream is recreated.

## Account and authentication boundary

Starting a room requires an OAuth-backed account. Joining does not.

- Supported provider code paths are Google, Apple, and Facebook. A provider is
  displayed only when its production credentials are configured.
- No password is created or stored by Lingua Relay.
- Browser sessions use a signed HttpOnly/Secure/SameSite session cookie.
- Native sessions use an app-bound one-time OAuth handoff and are kept in native
  secure storage. The native fetch bridge attaches the bearer only to the exact
  public origin and the small account/room-creation endpoint allow-list.
- Native session APIs require the installed-app origin in addition to a valid
  session bearer.
- The custom auth scheme is protected by a 256-bit app-held binding; seeing an
  intercepted handoff is insufficient to exchange it.
- Account deletion is available in-product and deletes the profile, aggregate
  usage totals, and recent usage rows. An old signed session whose account has
  been deleted is treated as signed out.

Version 1.0 is non-monetized. There is no purchase control, StoreKit/Play
Billing product, payment method, or stored credit balance in the active account
contract.

## Room identity and privacy

A participant room token is an HMAC-signed bearer valid for 24 hours. Its room
ID is random and its signature is verified before a Durable Object is selected.
The host receives a separate domain-separated host-control bearer. Host control
is never placed in the participant URL.

Participant URLs contain only the signed room token and, when required, the
presentation mode (`voice` or `chat`; video is the default). Personal/callee
labels are not collected for new rooms and are deliberately stripped from new
share, QR, and host-open URLs. Old links containing the retired bounded `n=`
label may still parse for compatibility, but the current host workflow does not
create or propagate them.

The Room Durable Object stores only what is needed for room lifecycle and
bounded usage/report controls. Browser participant metadata is kept in
hibernation-safe WebSocket attachments. Captions and media are never written to
Durable Object storage.

## Two-person invariant

Version 1.0 has one local participant and one remote participant—no group-room
mode.

The active Worker export enforces this through the `two-party-room.ts` wrapper,
and the installed room client independently fails closed if a welcome message
advertises a participant limit other than `2` or more than one remote peer.
Host status and mobile bootstrap likewise expose a limit of `2`.

The older base `worker.ts` Room implementation still contains its historical
four-participant constant. It is not the active exported room contract; the
wrapper enforces/re-writes the public boundary. This is recognized technical
debt. Do not remove the wrapper or export the base Room directly until the base
implementation itself has been migrated to the two-person invariant and the
full room suite has been run.

Room size and compute scale are separate concepts. Increasing Modal containers
must never increase room participant count.

## Compute capacity and cost controls

Modal has one public L4-backed ASGI Function. Development defaults preserve the
old cost envelope, but production horizontal scale is now deployment
configuration rather than an application-source rewrite.

Defaults:

```text
LINGUA_MODAL_STREAM_INPUTS=4
LINGUA_MODAL_TTS_INPUTS=1
LINGUA_MODAL_MAX_CONTAINERS=1
LINGUA_MODAL_MIN_CONTAINERS=0
LINGUA_MODAL_SCALEDOWN_WINDOW_S=60
LINGUA_MODAL_ROUTING_REGION=ap-south
```

The source validates these settings at import/deploy time. Stream inputs are
bounded to 2–16, short TTS/translate slots to 1–4, maximum containers to 1–64,
the warm floor cannot exceed the maximum, and scale-down is bounded to
30–3,600 seconds. The resolved stream/short-job limits are baked into the Modal
image so remote `InputCapacity` cannot silently disagree with the local Modal
concurrency decorator.

`@modal.concurrent` permits the stream slots plus short-job slots and targets
the stream-slot count. This leaves room for a short translation/TTS request and
allows Modal to place new work elsewhere before a container has exhausted its
long-lived stream reservation. Container-local admission remains the final
burst guard.

A rejected caption stream reports explicit capacity status; the Worker retries
with bounded backoff while natural WebRTC media remains independent and live.
TTS/typed-translation work fails fast when its short-job slot is occupied.

Raising capacity is a release operation that requires measured GPU memory,
caption latency, scale-out, recovery, and cost receipts. A nonzero
`LINGUA_MODAL_MIN_CONTAINERS` is an explicit paid warm-capacity decision.

## Mobile application structure

The Android and iOS products use Capacitor as a thin native shell around the
shared bundled web client. The app does not point its WebView at the production
site; core UI assets are bundled in the binary and the native bridge talks to
the public API origin.

Native responsibilities include:

- secure host/session storage;
- OAuth browser-to-app handoff;
- system share sheet;
- foreground/background lifecycle events;
- status-bar/safe-area integration;
- microphone/camera platform permissions;
- verified room links / associated domains.

`PUBLIC_ORIGIN` in the mobile runtime is the source of truth for public API and
room links. Native sync derives Android App Link and iOS Associated Domain hosts
from that origin so a future branded-domain switch does not require manual host
replacement in multiple platform files.

The call lifecycle is foreground-only for version 1.0. Backgrounding a room
closes signalling/peer/media resources; returning to the foreground creates one
fresh connection. The generated client guards both still-CONNECTING socket
teardown and stale scheduled reconnects so foreground restoration cannot create
duplicate room sockets.

## Media and WebRTC lifecycle

Camera and microphone permission are requested only from explicit user actions
(Call/Accept, microphone, camera). Merely opening an invite does not trigger
capture permission.

One media stream owns current local tracks. The microphone control governs both
the WebRTC sender and caption worklet. Translation playback pauses only the ASR
feed to prevent speaker feedback; it does not mute the live microphone track
sent to the other participant.

If an OS/device ends an active microphone or camera track, the UI moves to the
corresponding unavailable state instead of silently changing control state.

RTCPeerConnection uses perfect-negotiation state per remote peer, refreshed TURN
configuration, ICE restart on credential refresh, and explicit failure notes.
Network/compute failures never silently convert a failed translated-voice path
into muted natural audio.

## Data retention

Account data:

- profile: derived user ID, provider, display name, email — until deletion;
- aggregate usage totals — until deletion;
- recent usage rows — 90 days, capped at 200 rows;
- each usage row contains time, kind, units, and an opaque one-way room
  reference; never the participant link or conversation content.

Abuse reports:

- category, platform, time, opaque public room reference, and an internal
  non-invite routing ID needed for moderator closure;
- no report free text, participant name, transcript, chat text, audio, video,
  caption, screenshot, or participant bearer;
- 30-day retention with a bounded inbox.

Room lifecycle:

- signed participant/host controls expire after 24 hours;
- a host close persists a closed tombstone through that expiry;
- presence is lease-based and expires after 90 seconds without activity;
- long-lived infrastructure/security logs may exist under provider policies but
  are not application conversation history.

## Protocol/security controls

Current fail-closed limits include:

- 8 KiB normal control messages;
- up to 64 KiB only for validated WebRTC signalling;
- 32,000-byte PCM frames;
- 300-character captions/TTS text;
- 200-character typed chat;
- bounded TTS request/response sizes;
- eight pending browser sockets per room;
- exactly two joined participants in the active product;
- microphone byte-rate/burst limits;
- bounded TTS/chat/TURN/report quotas;
- short-lived TURN credentials;
- server-only Modal and TURN secrets;
- no long-lived secret in browser/native bundled JavaScript.

Room pages receive camera/microphone permissions policy only where needed and a
strict self-only script/style CSP in the launch wrapper. Dashboard/legal pages
cannot request camera/microphone through the hardened response policy.

## Acceptance gates before release

The development branch is not a release receipt. Before Apple/Google launch,
all of the following must be completed against the exact release commit and
production configuration:

| Gate | Required evidence |
|---|---|
| Two-person room | Browser/native tests show third participant rejected and all server/client limits report 2. |
| Account lifecycle | Google + Apple (and Facebook if enabled) sign-in, native handoff, logout, deletion, deleted-session rejection. |
| Native lifecycle | Real iOS/Android foreground/background, permission deny/regrant, device-loss and reconnect behavior. |
| WebRTC | Two real devices carry natural audio/video; forced direct-ICE failure proves a selected `relay` candidate. |
| Translation | Supported ASR/MT fixtures plus real two-person caption/chat flows; no unsupported quality claim. |
| Translated voice | Only visible declared profiles play; failure restores natural audio. |
| Compute | Exact deployment reports model revisions and, if capacity differs from defaults, load/scale/recovery/cost receipts. |
| Privacy/account | Store declarations, privacy manifest/Data Safety answers, account deletion, abuse-report schema and retention agree. |
| Store UI | Final phone layouts, safe areas, landscape, RTL, large text/accessibility, reduced motion and screenshots. |
| Native packages | Signed AAB/IPA/archive verification, Android 16 KiB/native-library checks, entitlements, privacy manifest, app links. |
| Support/legal | Production support contact and final public Privacy/Terms/Support URLs exist before submission. |

## Deliberate version-1 ceilings

- Exactly two room participants.
- Foreground-only call lifecycle; no CallKit/ConnectionService background-call
  promise yet.
- No monetization or digital-goods purchase path.
- No advertising, analytics SDK, transcript archive, or recording.
- No group rooms.
- No claim that every text language has tested microphone/voice quality.
- A custom/branded domain is desirable before launch but is not invented in
  source. When selected, the single public-origin configuration must be changed
  and association/OAuth/store URLs revalidated.
- Horizontal GPU capacity may be raised only with measured release receipts;
  per-container limits remain bounded.

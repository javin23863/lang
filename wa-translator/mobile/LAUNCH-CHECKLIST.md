# Lingua Relay mobile launch checklist

This file is the current launch source of truth for the Android and iOS apps.
Historical deployment receipts elsewhere in the repository may describe older
four-person experiments. Version 1.0 is a **two-person product**: one local
participant and one remote participant.

The development pass intentionally does **not** run GitHub Actions/CI or signed
release workflows. Checked build/automation items below mean the source/config
for that gate exists; the exact release commit must run the full verification
matrix after development is declared complete.

## Product contract

- [x] Room capacity is exactly two joined participants at the active exported
  `Room` boundary.
- [x] A third joined participant is rejected by the two-person wrapper.
- [x] Installed clients require `max_room_participants: 2` in bootstrap and fail
  closed against a different backend contract.
- [x] Shared room UI renders a two-person participant count.
- [x] Voice, video, text chat, live translated captions, and optional translated
  voice use the same private room bearer lifecycle.
- [x] Starting a room requires an OAuth account; joining an invite does not.
- [x] Account deletion is available in the app and removes account-held data.
- [x] Version 1.0 is non-monetized: no purchase surface, stored credit balance,
  StoreKit product, or Google Play Billing product is part of the active app.
- [x] New participant/share/QR/native room URLs contain only the signed room
  token and optional call mode; the retired personal-name query is not emitted.

## Native authentication

- [x] Browser accounts continue to use the existing HttpOnly cookie session.
- [x] Native Google/Facebook/Apple OAuth starts in the system browser.
- [x] Native auth returns through the registered Lingua Relay app scheme rather
  than relying on a same-domain Safari Universal Link redirect.
- [x] The short auth handoff is one-time, expires after 90 seconds, and is bound
  to a canonical 256-bit proof held by the installed app.
- [x] Current builds keep that raw proof in platform secure storage and put only
  its SHA-256 challenge in the system-browser start URL. The previous raw-query
  start remains temporarily accepted only for installed-build compatibility.
- [x] Duplicate cold-launch delivery of the same native handoff is idempotent.
- [x] The exchanged native session is stored in platform secure storage and is
  sent only to the versioned account/room-creation endpoints that require it.
- [x] A stale/expired native session self-clears on a protected-endpoint `401` or
  on the signed-out `/api/v1/me` snapshot instead of persisting across launches.
- [x] Every native session endpoint, including room creation, requires the exact
  installed-app origin in addition to the bearer.
- [x] Native logout and account deletion clear the stored native session.
- [x] Apple `form_post`, ES256 client-secret generation, token exchange, claims,
  native return and handoff exchange have regression contracts in source.
- [ ] **Production iOS gate:** the live `/api/v1/me` provider list includes
  `apple`. Do not submit iOS while Google/Facebook is offered without Apple.

## Links and signing identity

- [x] Public room invitations remain HTTPS App/Universal Links.
- [x] Android declares verified room links for the configured public host.
- [x] iOS carries the matching `applinks:` entitlement.
- [x] Native sync derives Android/iOS association hosts from the mobile runtime
  `PUBLIC_ORIGIN`, avoiding three independent hostname edits.
- [x] The auth-only custom scheme is registered on Android and iOS and its input
  parser accepts only the expected bound handoff shape/provider.
- [ ] **Android signed-build gate:** production `assetlinks.json` contains the
  SHA-256 fingerprint of the actual release signing certificate.
- [ ] **iOS signed-build gate:** production AASA contains the real Apple Team ID
  plus `com.javin23863.linguarelay` and claims `/room/*`.
- [x] The credential-gated beta workflow source checks these live associations
  before it uploads a signed build.

## Store metadata and assets

- [x] Google Play title is at most 30 characters.
- [x] Google Play short description is at most 80 characters.
- [x] Google Play full description is at most 4000 characters.
- [x] Play listing includes a 512x512 RGBA PNG icon.
- [x] Play listing includes a 1024x500 RGB PNG feature graphic.
- [x] Play listing includes at least two phone screenshots.
- [x] iOS name and subtitle are at most 30 characters each.
- [x] iOS description is at most 4000 characters.
- [x] iOS keywords are at most 100 UTF-8 bytes.
- [x] iOS listing has phone screenshots and configured privacy/support URLs.
- [x] Privacy, Terms, and Support pages exist in shared web/native assets and are
  routed by the Worker.
- [x] Legal pages use one fail-closed room-return validator and preserve only
  `voice`/`chat` mode, never arbitrary origins or retired personal labels.
- [x] Owner-supplied App Review / Play review inputs are enumerated in
  `REVIEW-INPUTS.md`, with secrets explicitly kept out of Git.
- [ ] **App Review gate:** create a dedicated public product-support contact and
  add it to `/support` before App Store submission. The repository currently has
  no support email/phone/legal contact to publish; do not expose a developer's
  personal source-control identity as a substitute.
- [ ] Enter App Review contact details, non-expiring OAuth review identity and
  notes directly in App Store Connect; enter Play app-access instructions and
  review identity directly in Play Console.

## Privacy, safety, and declarations

- [x] Camera and microphone usage descriptions are present on iOS.
- [x] Android declares camera/microphone as optional hardware features.
- [x] Calls are foreground-only; no background media mode is claimed.
- [x] iOS privacy manifest is source controlled and declares no tracking.
- [x] No advertising or analytics SDK is included in version 1.0.
- [x] No transcript history or call recording is intentionally stored.
- [x] Active account responses/storage retire the zero-only legacy credits field;
  existing accounts delete it on their next account read/write.
- [x] Abuse reporting is category-only and excludes names, room links, message
  content, captions, audio, video, screenshots and free text.
- [x] Category report records remain bounded to 30 days, while the internal room
  routing ID/expiry used only for moderator closure are removed when the room
  expires, no later than 24 hours after room creation.
- [x] Store declarations are maintained in `STORE-DECLARATIONS.md` and match the
  non-monetized account schema and report-retention lifetimes.
- [ ] Complete the final App Store age-rating/export-compliance questionnaires
  from actual product behavior and signing configuration.
- [ ] Complete the final Google Play Data safety/content-rating/app-access forms
  from actual product behavior and production account settings.

## Frontend and runtime structure

- [x] Host dashboard behavior and styles are extracted from `index.html` into
  `dashboard.js` and `dashboard.css` while keeping the existing runtime/API seam.
- [x] Dashboard deployment/native-bundle contracts assert those assets ship.
- [x] Dashboard presentation uses the Lingua Relay green/blue identity, adaptive
  appearance, reduced-motion handling and 44pt-or-larger primary touch targets.
- [x] Shipping room delivery decomposes canonical `room.html` styling/behavior
  into `room.css`, `room-ui.css`, and `room.js` without rewriting WebRTC state.
- [x] Room presentation has the Lingua Relay visual pass, safe-area/landscape
  handling, reduced motion and accessible live status/caption regions.
- [x] Active microphone/camera track loss produces a visible localized recovery
  state rather than silently changing controls.
- [x] Background teardown closes CONNECTING/OPEN sockets and reconnect generation
  guards prevent duplicate room WebSockets after foreground restoration.
- [x] Public UI responses deny undeclared CSP resource classes; room networking
  is restricted to same-origin HTTP plus the exact page-host WebSocket origin.
- [x] Dynamic account/auth/room/API responses are `no-store`, and all non-socket
  responses receive `nosniff` and `no-referrer` at the outer Worker boundary.

## Compute/backend structure

- [x] Cloudflare remains the room/account/signalling control plane; Modal owns
  only authenticated ASR/MT/TTS compute.
- [x] Modal per-container stream/short-job admission is bounded.
- [x] Horizontal GPU scale, warm floor, scale-down window and routing region are
  validated deployment settings rather than hard-coded application constants.
- [x] Development defaults preserve the one-scale-to-zero-L4 cost envelope.
- [x] Resolved per-container admission values are baked into the Modal image so
  remote runtime and deployment decorator cannot diverge.
- [x] Mobile bootstrap no longer advertises the retired `4 global streams /
  beta-limited` compute capacity as an installed-client compatibility promise.
- [x] Room compute/network handshakes have a 30-second ceiling while preserving
  shorter caller deadlines such as the existing eight-second chat timeout.
- [ ] Before raising production GPU ceilings, retain measured latency, memory,
  scale-out/recovery and cost receipts for the exact release configuration.

## Build and beta gates — run after development is complete

- [x] Credential-free workflow source typechecks/tests the mobile client.
- [x] Credential-free workflow source runs the Worker/product regression suite.
- [x] Credential-free workflow source builds an Android release AAB.
- [x] Credential-free workflow source builds the iOS Release target with signing
  disabled.
- [x] Signed Android automation is scoped to the Play internal track.
- [x] Signed iOS automation is scoped to TestFlight.
- [x] Signed upload workflow source includes live mobile-contract/provider/link
  association preflight before store upload.
- [x] npm install scripts are version-pinned in `allowScripts`; workflow config
  uses `strict-allow-scripts=true` so a new unreviewed install script fails closed.
- [ ] Run the complete credential-free test/build matrix against the exact final
  development commit.
- [ ] Run the signed Android and iOS beta workflows against that same commit.
- [ ] Install the signed Android internal build on representative physical
  devices and exercise account, link, media-permission and call lifecycles.
- [ ] Install the TestFlight build on representative physical iPhones and
  exercise the same lifecycle including real Apple sign-in.
- [ ] Test Wi-Fi, cellular, network changes, permission revoke/regrant, app
  foreground/background transitions, interruption, reconnect and room expiry.

## Production operations still requiring credentials or console access

- [ ] Select/configure the final public production origin. A branded domain is
  preferred; do not invent one in source before it exists.
- [ ] Provision live Google OAuth credentials/callback for that origin.
- [ ] Provision live Apple Services ID, Key ID, private key and Team ID.
- [ ] Provision Facebook only if it will actually be offered at launch.
- [ ] Configure the production Android release certificate fingerprint in the
  Worker association output.
- [ ] Configure the production Apple Team ID in the Worker association output.
- [ ] Add the required GitHub environment secrets for signed beta automation.
- [ ] Run both signed beta workflows successfully and retain install receipts.
- [ ] Create/verify the Play Console and App Store Connect records, agreements,
  tax/banking state where applicable, pricing/availability and reviewer notes.

## Known structural debt after P0

`cloudflare/src/worker.ts` still contains the legacy four-person implementation
that predates the version 1.0 decision. Production/dev Wrangler entry points use
`src/launch-entry.ts` → `src/mobile-entry.ts`, which exports the strict two-person
`Room` wrapper, and installed clients independently fail closed on a different
contract. Do not deploy/export the base `worker.ts` `Room` directly. A later
refactor should move the two-person invariant into the base Room and delete the
wrapper, but that refactor should be performed only with the complete room suite
available to run.

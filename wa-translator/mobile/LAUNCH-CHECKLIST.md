# Lingua Relay mobile launch checklist

This file is the current launch source of truth for the Android and iOS apps.
Historical deployment receipts elsewhere in the repository may describe older
four-person experiments. Version 1.0 is a **two-person product**: one local
participant and one remote participant.

Automatic PR GitHub Actions may run during development and are useful diagnostic
evidence, but they do **not** satisfy final release acceptance because pull-request
runs check GitHub's synthetic merge ref. Checked build/automation items below mean
the source/config for that gate exists; the exact frozen release commit must run
the full credential-free matrix deliberately before signed beta/device gates.

## Product contract

- [x] Room capacity is exactly two joined participants at the active exported
  `Room` boundary.
- [x] A third joined participant is rejected by the two-person wrapper; an
  already-expired 90-second presence lease does not falsely hold that slot.
- [x] Installed clients require `max_room_participants: 2` in bootstrap and fail
  closed against a different backend contract.
- [x] Shared room UI renders a two-person participant count.
- [x] Voice, video, text chat, live translated captions, and optional translated
  voice use the same private room bearer lifecycle.
- [x] Starting a room requires an OAuth account; joining an invite does not.
- [x] A room-creation session is accepted only while its `UserDirectory` account
  still exists. Account deletion immediately blocks old browser/native sessions
  from creating another room.
- [x] The retired `POST /rooms` HTML-form creator is disabled; `/api/rooms` and
  its native versioned adapter are the only host room-creation contract.
- [x] Account deletion is available in the app and removes account-held data.
- [x] Successful logout/account deletion also removes the device-local saved
  host-control bearer so a later account on a shared device cannot inherit room
  administration. Already-issued participant rooms remain independent until
  their normal expiry.
- [x] Version 1.0 is non-monetized: no purchase surface, stored credit balance,
  StoreKit product, or Google Play Billing product is part of the active app.
- [x] New participant/share/QR/native room URLs contain only the signed room
  token and optional call mode; the retired personal-name query is not emitted.

## Native authentication

- [x] Newly issued browser sessions are nonce-bearing `s2` credentials in an
  HttpOnly/Secure/SameSite cookie; newly issued native sessions use the same
  `s2` format in platform secure storage.
- [x] Each `s2` issuance carries a random 128-bit nonce. Two logins for the same
  user with the same expiry remain different credentials and can be revoked
  independently.
- [x] The shipping edge temporarily accepts valid legacy `s1` sessions for
  migration, but only a verified session may be translated to an internal `s1`
  representation for the pre-v2 Worker. Revocation always hashes the exact
  external credential, never that internal representation.
- [x] Native bootstrap protocol `2` marks the session-format compatibility
  boundary; pre-v2 installed clients fail closed before starting OAuth.
- [x] Native Google/Facebook/Apple OAuth starts in the system browser.
- [x] Native auth returns through the registered Lingua Relay app scheme rather
  than relying on a same-domain Safari Universal Link redirect.
- [x] The short auth handoff is one-time, expires after 90 seconds, and is bound
  to a canonical 256-bit proof held by the installed app.
- [x] Current builds keep that raw proof in platform secure storage and put only
  its SHA-256 challenge in the system-browser start URL. The previous raw-query
  start remains temporarily accepted only for installed-build compatibility.
- [x] A migrated legacy proof is not erased from WebView storage until its
  secure-storage copy has actually succeeded, so process death cannot strand an
  OAuth callback during the compatibility transition.
- [x] A native auth proof is retired after terminal success or failure; duplicate
  cold-launch delivery of the same handoff is idempotent.
- [x] The process-local duplicate-handoff cache is capped at 16 entries and
  evicts the oldest entry, so externally delivered custom-scheme traffic cannot
  grow authentication replay state without bound.
- [x] Wrong-method provider callback requests use the base `405` path without
  consuming the native marker/state for a legitimate callback still in flight.
- [x] Native handoff responses strip lower-layer `Set-Cookie` state and expose
  only the upgraded `s2` bearer plus its signed expiry.
- [x] The exchanged native session is stored in platform secure storage before
  it becomes active in the in-process fetch interceptor and is sent only to the
  versioned account/room-creation endpoints that require it.
- [x] A stale/expired native session self-clears on a protected-endpoint `401` or
  on the signed-out `/api/v1/me` snapshot instead of persisting across launches.
- [x] A stale browser session cookie is expired when `/api/me` confirms that its
  account is gone, rather than remaining plausible until the 30-day token expiry.
- [x] Logout durably revokes the exact browser/native session before local
  credential clearing. A copied bearer cannot be replayed after logout, while a
  distinct still-live session for the same account remains valid.
- [x] Logout revocation stores only a one-way SHA-256 token digest plus original
  expiry; it disappears with that credential (no later than 30 days from sign-in)
  and account deletion removes it immediately.
- [x] Every native session endpoint, including room creation, requires the exact
  installed-app origin in addition to the bearer.
- [x] Versioned native CORS preflights reject unknown/wrong methods and advertise
  only each endpoint's actual method plus `OPTIONS`.
- [x] Native logout and account deletion clear the stored native session only
  after a successful server response; revocation failure stays retryable locally.
- [x] Apple `form_post`, ES256 client-secret generation, token exchange, claims,
  native return and handoff exchange have regression contracts in source.
- [x] Apple's one-time `user` form field contributes only a bounded display name
  after normal OAuth validation succeeds. Token-derived email/provider/account
  identity remain authoritative, and later Apple logins preserve that captured
  name when Apple no longer sends the one-time field.
- [ ] **Production iOS gate:** the live `/api/v1/me` provider list includes
  `apple`. Do not submit iOS while Google/Facebook is offered without Apple.

## Links and signing identity

- [x] Public room invitations remain HTTPS App/Universal Links.
- [x] Android declares verified room links for the configured public host.
- [x] iOS carries the matching `applinks:` entitlement.
- [x] Native sync derives Android/iOS association hosts from the mobile runtime
  `PUBLIC_ORIGIN`, avoiding three independent hostname edits.
- [x] Production Wrangler, native association sync, and signed-store preflight
  are source-guarded against the same canonical `PUBLIC_ORIGIN`; local Wrangler
  remains deliberately isolated on `127.0.0.1`.
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
- [x] Privacy, Terms, Support, and a dedicated account-deletion page exist in
  shared web/native assets.
- [x] The Google Play external account-deletion resource is the production URL
  ending in `/delete-account.html`; it identifies Lingua Relay, works without
  reinstalling the app, and routes into browser account controls.
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
- [x] Room entry requires affirmative acceptance of the current Terms version;
  the checkbox is not preselected, and older `2026-08-14` consent does not carry
  forward to the current `2026-08-25` Terms.
- [x] iOS privacy manifest is source controlled and declares no tracking.
- [x] No advertising or analytics SDK is included in version 1.0.
- [x] No transcript history or call recording is intentionally stored.
- [x] OAuth display metadata is stripped of C0/C1 controls and Unicode bidi
  override/isolate formatting before storage, while international text remains
  supported and provider/subject-derived account identity is never rewritten.
- [x] Once an account Durable Object exists, its derived user ID and provider are
  immutable; later provider refreshes that omit presentation claims preserve the
  account's prior non-empty name/email instead of erasing them.
- [x] Active account responses/storage retire the zero-only legacy credits field;
  successful profile reads/writes and usage writes all remove it.
- [x] Abuse reporting is category-only and excludes names, room links, message
  content, captions, audio, video, screenshots and free text.
- [x] Category report records are enforced at a 30-day ceiling even on direct
  moderator resolve access; malformed/future retention timestamps fail closed.
- [x] The internal room routing ID/expiry used only for moderator closure are
  removed when the room expires, no later than 24 hours after room creation;
  malformed routing metadata is stripped immediately.
- [x] The operator moderation CLI reads its admin token only from the environment,
  exposes only the minimized queue, and can close a still-live room by report ID.
- [x] Store declarations are maintained in `STORE-DECLARATIONS.md` and match the
  non-monetized account schema and report-retention lifetimes.
- [ ] Assign a monitored moderation operator/on-call owner and verify the live
  private queue before public store submission.
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
- [x] Voice mode is a foreground two-person room rather than a fake incoming-call
  service; either participant join order converges on Connected without a
  ringing/answer dependency.
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
- [x] Shipping Worker external waits are bounded: Modal 30 seconds, TURN 10
  seconds, and OAuth/provider calls 20 seconds; network/timeout failures enter
  each endpoint's existing fail-closed unavailable/auth-failed path.
- [x] Room usage is moved to a durable pending snapshot before account delivery;
  transient delivery failures retry every five minutes only within the room's
  existing lifetime, successful retries restore the normal expiry alarm, and a
  deleted account (`404`) drops both backlog and later counters without revival.
- [x] Each pending usage snapshot has a stable per-kind delivery ID. Account
  totals, recent row and dedupe marker commit atomically, so a lost response and
  retry cannot double-count; dedupe markers expire after 48 hours.
- [x] A usage retry that fires after the room has been rejoined drains only the
  older backlog and leaves the active call's counters in the active buffer.
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
- [x] Signed-release preflight compares the live backend's minimum client build
  against the exact Android versionCode/iOS CFBundleVersion being uploaded.
- [x] Final signed AAB/IPA verification checks the packaged build number, signing
  identity, platform identity/permissions/privacy contract and credential
  hygiene before either beta upload command runs.
- [x] Android release versionCode generation is monotonic across the earlier
  Unix-seconds strategy, reserves retry space, and fails before Google's
  2,100,000,000 ceiling.
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
- [ ] Enter the final production `/delete-account.html` URL in Play Console's
  designated account-deletion field and verify it returns the public resource.
- [ ] Run both signed beta workflows successfully and retain install receipts.
- [ ] Create/verify the Play Console and App Store Connect records, agreements,
  tax/banking state where applicable, pricing/availability and reviewer notes.

## Known structural debt after P0

`cloudflare/src/worker.ts` still contains the legacy four-person implementation
that predates the version 1.0 decision. Production/dev Wrangler entry points use
`src/session-issuance-entry.ts` → `src/account-guard-entry.ts` →
`src/launch-entry.ts` → `src/mobile-entry.ts`, which exports the strict
two-person `Room` wrapper. Installed clients independently fail closed on a
different participant or native protocol contract. Do not deploy or export the
base `worker.ts` `Room` directly. A later refactor should move the two-person and
session-v2 invariants into the base implementation and delete the wrapper layers,
but that refactor should be performed only with the complete room/auth suite
available to run.

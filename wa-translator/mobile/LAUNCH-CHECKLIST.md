# Lingua Relay mobile launch checklist

This file is the current launch source of truth for the Android and iOS apps.
Historical deployment receipts elsewhere in the repository may describe older
four-person experiments. Version 1.0 is a **two-person product**: one local
participant and one remote participant.

## Product contract

- [x] Room capacity is exactly two joined participants.
- [x] A third joined participant is rejected by the deployed `Room` boundary.
- [x] Installed clients require `max_room_participants: 2` in bootstrap and fail
  closed against a different backend contract.
- [x] Shared room UI renders a two-person participant count.
- [x] Voice, video, text chat, live translated captions, and optional translated
  voice use the same private room bearer lifecycle.
- [x] Starting a room requires an OAuth account; joining an invite does not.
- [x] Account deletion is available in the app and removes account-held data.
- [x] Version 1.0 has no purchase flow; the credits purchase control is disabled.

## Native authentication

- [x] Browser accounts continue to use the existing HttpOnly cookie session.
- [x] Native Google/Facebook/Apple OAuth starts in the system browser.
- [x] Native auth returns through the registered Lingua Relay app scheme rather
  than relying on a same-domain Safari Universal Link redirect.
- [x] The short auth handoff is one-time, expires after 90 seconds, and is bound
  to 256 random bits held by the app that initiated the provider flow.
- [x] The exchanged native session is stored in platform secure storage and is
  sent only to the versioned account/room-creation endpoints that require it.
- [x] Native logout and account deletion clear the stored native session.
- [x] Apple `form_post`, ES256 client-secret generation, token exchange, claims,
  native return and handoff exchange are covered by the Worker regression suite.
- [ ] **Production iOS gate:** the live `/api/v1/me` provider list includes
  `apple`. Do not submit iOS while Google/Facebook is offered without Apple.

## Links and signing identity

- [x] Public room invitations remain HTTPS App/Universal Links.
- [x] Android declares verified room links for the production Worker host.
- [x] iOS carries the matching `applinks:` entitlement.
- [x] The auth-only custom scheme is registered on Android and iOS and its input
  parser accepts only the expected bound handoff shape/provider.
- [ ] **Android signed-build gate:** production `assetlinks.json` contains the
  SHA-256 fingerprint of the actual release signing certificate.
- [ ] **iOS signed-build gate:** production AASA contains the real Apple Team ID
  plus `com.javin23863.linguarelay` and claims `/room/*`.
- [x] The credential-gated beta workflow checks these live associations before
  it uploads a signed build.

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
- [x] iOS listing has phone screenshots and production privacy/support URLs.
- [x] Privacy, Terms, and Support pages are served by the production Worker.
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
- [x] Abuse reporting is category-only and excludes names, room links, message
  content, captions, audio, video, screenshots and free text.
- [x] Store declarations are maintained in `STORE-DECLARATIONS.md`.
- [ ] Complete the final App Store age-rating/export-compliance questionnaires
  from actual product behavior and signing configuration.
- [ ] Complete the final Google Play Data safety/content-rating/app-access forms
  from actual product behavior and production account settings.

## Build and beta gates

- [x] Credential-free CI typechecks and tests the mobile client.
- [x] Credential-free CI runs the Worker/product regression suite.
- [x] Credential-free CI builds an Android release AAB.
- [x] Credential-free CI builds the iOS Release target with signing disabled.
- [x] Signed Android automation stops at the Play internal track.
- [x] Signed iOS automation stops at TestFlight.
- [x] Signed uploads run the live mobile-contract/provider/link-association
  preflight before store upload.
- [x] npm install scripts are version-pinned in `allowScripts`; CI uses
  `strict-allow-scripts=true` so a new unreviewed install script fails closed.
- [ ] Install the signed Android internal build on representative physical
  devices and exercise account, link, media-permission and call lifecycles.
- [ ] Install the TestFlight build on representative physical iPhones and
  exercise the same lifecycle including real Apple sign-in.
- [ ] Test Wi-Fi, cellular, network changes, permission revoke/regrant, app
  foreground/background transitions, interruption, reconnect and room expiry.

## Frontend structure

- [x] Host dashboard behavior and styles are extracted from `index.html` into
  `dashboard.js` and `dashboard.css` while keeping the existing runtime/API seam.
- [x] Dashboard deployment/native-bundle tests assert those assets are shipped.
- [x] Dashboard presentation uses the Lingua Relay green/blue identity, adaptive
  appearance, reduced-motion handling and 44pt-or-larger primary touch targets.
- [ ] `room.html` remains the largest frontend monolith. Split its styling and
  behavior only with a full-file-preserving edit path; do not perform a lossy
  partial replacement because it contains WebRTC/media/signalling state.
- [ ] After room decomposition is green, do the room-specific visual pass without
  changing the proven two-person/media protocol contract.

## Production operations still requiring credentials or console access

- [ ] Provision live Google OAuth credentials/callback.
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
`src/mobile-entry.ts`, which exports the strict two-person `Room` wrapper, and CI
exercises that boundary. Do not deploy `worker.ts` directly. A later refactor
should move the two-person invariant into the base Room and delete the wrapper,
but that is not required to change the currently deployed product contract.

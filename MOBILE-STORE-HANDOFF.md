# Lingua Relay mobile-store handoff

Status date: 2026-08-14. Branch: `feat/mobile-store-shell`.

## What is built

- One Capacitor 8 application named **Lingua Relay** for Android and iOS.
- Fixed identifier: `com.javin23863.linguarelay`.
- The application bundles the reviewed web interface. It is not a remote-site
  wrapper and does not need the Codex browser or the Windows host.
- Cloudflare remains the public room/signalling API and Modal remains the
  speech/translation/optional-voice compute service.
- Host controls use Android Keystore-backed encrypted storage or iOS Keychain.
- WhatsApp and other messaging apps use the native share sheet. No WhatsApp SDK
  or additional paid link service is required.
- Exact signed room links are accepted through Android App Links and iOS
  Universal Links; wrong hosts, query strings, and malformed tokens fail closed.
- Camera and microphone are foreground-only and requested independently from
  their own controls. Denying camera does not disable microphone captions.
- A live participant can submit one private category-only abuse report and
  block that room locally. The stored report has no free text, participant
  bearer, transcript, or media; reports expire after 30 days.
- Store privacy, terms, and support pages are served by the existing Worker.
- Android AAB and unsigned iOS compilation run without credentials. Signed
  uploads are manual jobs and stop at Play Internal Testing or TestFlight.

## Current beta receipt — 2026-08-14 11:04 +07

- Public origin: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`.
  Worker version `f2c94502-82f3-4281-809f-3aed424bb25b` was deployed from
  `b7b0fffdd41816b45cf0e1ee53893b6802d75853` at 10:55 +07.
- The deployed no-secret acceptance probe returned health 200, mobile bootstrap
  200, room creation 201, WebSocket welcome, category-only report 201, private
  report list 200, moderator close 200, and closed-room preflight 410.
- A generated 32-byte report-admin credential is installed in the Worker and
  backed up with Windows DPAPI at
  `C:\Users\MSI\AppData\Local\LiveTranslator\report-admin-token.dpapi`.
  The plaintext value was never written to the repository or receipts.
- The live public two-tab browser acceptance passed the compact 106-profile
  picker, Khmer and Arabic RTL layouts, native sharing, audio/video WebRTC,
  independent camera/microphone acquisition, permission revoke/regrant,
  device speech, translated WAV playback, feedback protection, and Leave.
- GitHub Actions run `31768096990` completed Android, iOS, and product-regression
  jobs successfully. Its downloaded Android AAB is 3,095,207 bytes with SHA-256
  `C9D1196739A69B6CCC7738DFE292051EF568FCA83CE3C3A4F498E4C1FCA3296E`.
  The unsigned iOS app executable is 441,048 bytes with SHA-256
  `232F76EFE5B106FF977493924F5B5C6FA68E0BB4FD0400E90B7487B046C4B120`.
- Store screenshots were regenerated from that live public surface. They do not
  contain localhost URLs, unavailable-capability warnings, fabricated captions,
  or development explanation text.

## Commands

From `wa-translator/mobile`:

```text
npm ci
npm run check
npm run assets
npm run sync
```

The normal pull-request workflow builds both native projects. The separate
`Mobile beta upload` workflow is deliberately manual and uses the protected
`mobile-beta` environment.

## One-time account setup

These actions cannot be completed before the account owners are known. Paying
the subscriptions is necessary, but the stores also require identity checks,
agreements, signing ownership, listing review, closed testing, and physical
device acceptance.

### Google Play

1. Pay and verify the Play Console developer account.
2. Create the app with package `com.javin23863.linguarelay` and enable Play App
   Signing.
3. Create a Play service account with release access to this app.
4. Add protected GitHub environment secrets `LINGUA_ANDROID_KEYSTORE_B64`,
   `LINGUA_ANDROID_KEYSTORE_PASSWORD`, `LINGUA_ANDROID_KEY_ALIAS`,
   `LINGUA_ANDROID_KEY_PASSWORD`, and `GOOGLE_PLAY_JSON_KEY_B64`.
5. Copy the **Play App Signing** SHA-256 certificate fingerprint—not the upload
   key fingerprint—to Cloudflare Worker secret `MOBILE_ANDROID_CERT_SHA256`.
6. Run `Mobile beta upload` with `android`. After protected-environment
   approval it makes the build available on the Internal Testing track;
   production remains a manual Play Console decision.

### Apple

1. Pay and verify the Apple Developer membership and accept current agreements.
2. Register bundle ID `com.javin23863.linguarelay` with Associated Domains.
3. Create an App Store Connect API key with app-management access.
4. Add protected GitHub environment secrets `APP_STORE_CONNECT_KEY_ID`,
   `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_B64`, and
   `APPLE_TEAM_ID`. Export one reusable Apple Distribution certificate and
   profile, then add `APPLE_DISTRIBUTION_P12_B64`,
   `APPLE_DISTRIBUTION_CERT_PASSWORD`, `APPLE_PROVISIONING_PROFILE_B64`, and
   `APPLE_PROVISIONING_PROFILE_NAME`. CI imports these into an ephemeral
   keychain; it never creates or consumes a new certificate.
5. Put the public Team ID in Cloudflare Worker secret `MOBILE_APPLE_TEAM_ID`.
6. Run `Mobile beta upload` from `main` with `ios`. It imports the reusable
   signing identity into a temporary CI keychain and uploads to TestFlight.

### Abuse-report operations

1. Generate a random 32-byte-or-longer value and install the same value as the
   Worker secret `MOBILE_REPORT_ADMIN_TOKEN` and in the operator's private
   password manager. Never add it to the repository or a room URL.
2. Review `GET /api/internal/reports` with `Authorization: Bearer <token>` on a
   documented schedule throughout beta testing. The response contains only
   category, platform, timestamp, opaque room reference, and report ID.
3. Close an active reported room with authenticated `POST
   /api/internal/reports/<report-id>/close`, or pause the beta when a category
   trend requires broader intervention. The service resolves the report to an
   internal room routing ID without returning the participant link. Records
   delete automatically after 30 days; the inbox is bounded to 500 records.

Both association endpoints deliberately return 503 until their exact public
certificate/team binding is configured. This prevents a false green deep-link
claim before store ownership exists.

## Submission source of truth

- Android and iOS listing copy: `wa-translator/mobile/fastlane/metadata`.
- Screenshots: Android metadata image folder and `fastlane/screenshots/en-US`.
- Privacy and store answers: `wa-translator/mobile/STORE-DECLARATIONS.md`.
- Public pages: `/privacy`, `/terms`, and `/support` on the Worker origin.
- Architecture and acceptance rows: `MOBILE-STORE-PLAN.md`.
- Reused open-source workflow research: `MOBILE-STORE-REUSE-SOURCES.md`.

## Launch boundary

The code and unsigned store artifacts can be completed here. Paying the store
fees alone does not complete identity, agreements, signing, review, moderation,
or physical-device testing. The first store submission should be a closed beta.
A public production launch
remains blocked until all of these are observed on physical devices:

- Android-to-iPhone room links open the installed app on both platforms.
- Both people grant/revoke camera and microphone and complete a real call.
- WhatsApp sharing, background/foreground recovery, natural audio, captions,
  and optional translated voice pass on both platforms.
- A relay-only TURN test succeeds on restricted networks.
- Caption/voice admission is sized beyond the present beta compute ceiling or
  the release audience is explicitly limited to the supported capacity.
- Current store privacy/content-rating/export-compliance forms are reviewed by
  the account owner and each beta is approved before production.

No automated browser or synthetic-audio check substitutes for these physical
store launch gates.

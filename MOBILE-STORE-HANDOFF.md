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
- Camera and microphone are foreground-only and begin only after Start.
- Store privacy, terms, and support pages are served by the existing Worker.
- Android AAB and unsigned iOS compilation run without credentials. Signed
  uploads are manual jobs and stop at Play Internal Testing or TestFlight.

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
the subscriptions is necessary but the stores also require identity checks and
legal agreements.

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
6. Run `Mobile beta upload` with `android`. It uploads a draft release to the
   Internal Testing track; production remains a manual Play Console decision.

### Apple

1. Pay and verify the Apple Developer membership and accept current agreements.
2. Register bundle ID `com.javin23863.linguarelay` with Associated Domains.
3. Create an App Store Connect API key with app-management access.
4. Add protected GitHub environment secrets `APP_STORE_CONNECT_KEY_ID`,
   `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_B64`, and
   `APPLE_TEAM_ID`.
5. Put the public Team ID in Cloudflare Worker secret `MOBILE_APPLE_TEAM_ID`.
6. Run `Mobile beta upload` with `ios`. It creates/reuses distribution signing,
   installs the profile in the temporary CI keychain, and uploads to TestFlight.

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

The first store submission should be a closed beta. A public production launch
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

# Lingua Relay

Lingua Relay is a **two-person, foreground multilingual conversation product**.
It supports video, voice, text chat, live translated captions, and optional
translated voice through one private room model.

The authoritative Version 1.0 product boundary is
[`RELEASE-1.0.md`](RELEASE-1.0.md). Read that before changing room capacity,
authentication, monetization, privacy, native-link behavior, or release gates.
The implementation/gate status is tracked in
[`wa-translator/mobile/LAUNCH-CHECKLIST.md`](wa-translator/mobile/LAUNCH-CHECKLIST.md).
The current development/product-test checkpoint is
[`PRODUCT-TEST-HANDOFF.md`](PRODUCT-TEST-HANDOFF.md); it states what can actually
be exercised now and what remains unverified.

## Version 1.0 product contract

- Exactly **two joined participants** per room: one local person and one remote
  person. There is no group-room or four-person Version 1.0 path.
- The host signs in before creating a room. The invited participant opens the
  private link without an account.
- Version 1.0 is free/non-monetized. There is no active credit balance,
  subscription, StoreKit product, or Google Play Billing product.
- Rooms are foreground-only. The app does not claim incoming VoIP/background
  calling, call recording, transcript history, voice cloning, advertising, or
  analytics SDK behavior.
- New invitation URLs contain only the signed room token and optional local call
  mode. They do not contain participant names, phone numbers, or account IDs.
- Rooms and host-control credentials expire no later than 24 hours after room
  creation.

Historical specs and August 14 mobile/store receipts describe earlier beta
shapes, including accountless/four-person experiments. They are retained as
engineering history, not as the Version 1.0 product contract.

## Architecture

### Cloud control plane

Cloudflare Worker + Durable Objects own:

- room creation, room lifetime, signalling and host control;
- strict two-person admission at the active exported `Room` boundary;
- OAuth account/session integration;
- native compatibility/bootstrap and auth-handoff endpoints;
- TURN credential issuance;
- bounded abuse controls and the private category-only report inbox;
- public web/legal/store-support assets.

The shipping Worker entry path is:

```text
account-guard-entry.ts
  -> launch-entry.ts
  -> mobile-entry.ts
  -> two-party-room.ts / account-directory.ts / report-inbox.ts
```

`cloudflare/src/worker.ts` still contains historical pre-v1 room behavior and
must not be deployed/exported directly. See `RELEASE-1.0.md` for the structural
debt boundary.

### Speech/translation compute

Modal owns authenticated ASR, machine translation, and optional translated
voice compute. Camera and natural peer audio use WebRTC; the translation lane
receives the speech/caption feed needed for live translation.

The shared capability catalog defines supported Language/Locale/voice-profile
behavior. Locale variants map to their declared base language and do not imply a
separate ASR/MT quality claim.

### Native app

The Android/iOS app lives in `wa-translator/mobile` and uses **Capacitor 8**. It
bundles reviewed web assets locally; it is not a remote-site WebView shortcut.

Application identifier:

```text
com.javin23863.linguarelay
```

Native seams include:

- Android App Links / iOS Universal Links for public room invitations;
- an app-only custom scheme for OAuth return;
- system-browser Google/Apple/Facebook OAuth when each provider is configured;
- app-bound, one-time native auth handoff;
- Keychain/Keystore-backed secure storage for native session/proof and host
  control state;
- native share sheet and lifecycle handling;
- compatibility bootstrap that fails closed on an incompatible backend,
  including any room contract other than `max_room_participants: 2`.

## Accounts and sessions

Only a host needs an account. Browser sessions use an HttpOnly/Secure cookie;
native sessions are stored in platform secure storage and sent only to the
versioned account/room-creation API paths that require them.

Protected room creation/account mutations require both a valid session and a
still-existing `UserDirectory` account. Logout durably revokes the exact session
before local credential clearing; another independent session for the same
account remains valid. Account deletion removes account-held data and prevents
old sessions from creating new rooms.

Provider subject + provider namespace derives account identity. Display
metadata is presentation-only: unsafe control/bidi formatting is removed,
provider/user ID is immutable after account creation, and later omitted provider
claims do not erase an established profile. Apple's one-time `user` form field
can supply only a bounded display name after normal OAuth validation succeeds.

## Room lifecycle

A participant link is a private bearer. Anyone who possesses an unexpired link
can enter its room, so do not publish room links publicly.

The host-control bearer is different from the participant link and stays on the
host device. A successful sign-out or account deletion removes locally saved
host control so another account on a shared device cannot inherit room admin.
The already-issued participant room itself remains independent until explicit
close or normal expiry.

Voice mode is a foreground two-person room, not an artificial telephone
ringing/answer service. Either join order converges on Connected once both
participants are present.

## Privacy and moderation

Lingua Relay intentionally stores no conversation history: no audio, video,
caption transcript, chat body, translated-voice audio, screenshot, or free-text
abuse report is retained as a conversation record.

Account usage rows are bounded and retained for up to 90 days (most recent 200).
Retry-deduplication metadata lasts 48 hours. Logout replay protection stores only
a SHA-256 digest plus the session's original expiry and disappears no later than
that session credential.

Abuse reports are category-only and exclude names, room links, message/caption
content, audio, video, screenshots, and free text. Report records have a 30-day
ceiling; internal room-routing metadata used only for moderator closure is
removed when that room expires, no later than 24 hours after creation.

Current public policy/store declaration sources:

- `wa-translator/windows/static/privacy.html`
- `wa-translator/windows/static/terms.html`
- `wa-translator/windows/static/support.html`
- `wa-translator/windows/static/delete-account.html`
- `wa-translator/mobile/STORE-DECLARATIONS.md`

## Development paths

### Mobile

From `wa-translator/mobile`:

```text
npm ci
npm run check
npm run assets
npm run sync
```

The full exact-head credential-free matrix, signed Android/iOS beta workflows,
and physical-device acceptance are **release gates**, not development claims.
They are intentionally run only after the current development pass is declared
complete.

### Local Windows adapter

The Windows adapter is the local UI/protocol development path and does not define
store-release architecture. See:

- [`wa-translator/windows/README.md`](wa-translator/windows/README.md)
- [`SPEC-v7.md`](SPEC-v7.md) for historical/local adapter design background
- [`CLOUD-ARCHITECTURE.md`](CLOUD-ARCHITECTURE.md) for cloud architecture

## Release source of truth

Use these in order:

1. [`RELEASE-1.0.md`](RELEASE-1.0.md) — Version 1.0 product boundary.
2. [`wa-translator/mobile/LAUNCH-CHECKLIST.md`](wa-translator/mobile/LAUNCH-CHECKLIST.md)
   — implemented vs remaining release gates.
3. [`PRODUCT-TEST-HANDOFF.md`](PRODUCT-TEST-HANDOFF.md) — current development
   checkpoint, test paths, and explicit unverified boundaries.
4. [`wa-translator/mobile/STORE-DECLARATIONS.md`](wa-translator/mobile/STORE-DECLARATIONS.md)
   — store/privacy answers.
5. [`wa-translator/mobile/REVIEW-INPUTS.md`](wa-translator/mobile/REVIEW-INPUTS.md)
   — owner-provided store-review inputs.
6. Runtime code/tests and `CLOUD-ARCHITECTURE.md` — implementation detail.

The following are retained as dated history/research and may describe superseded
beta behavior: `MOBILE-STORE-PLAN.md`, `MOBILE-STORE-HANDOFF.md`,
`MOBILE-STORE-REUSE-SOURCES.md`, `MULTILINGUAL-PRODUCT-HANDOFF.md`, and older
`SPEC-v*` files.

## Final release gates still outside source-only development

The launch checklist remains authoritative, but the major non-source gates are:

- choose/configure the final public production origin;
- provision live Google/Apple (and Facebook if offered) OAuth credentials;
- configure Play App Signing fingerprint and Apple Team ID associations;
- install protected signing/store-upload secrets;
- provide a monitored moderation owner and public product-support contact;
- complete Play/App Store records, reviewer access, privacy/content/rating/export
  forms, and required agreements;
- run the complete credential-free matrix on the exact final development commit;
- run signed Play Internal/TestFlight workflows on that same commit;
- perform representative physical Android/iPhone testing, including real Apple
  sign-in, links, media permissions, Wi-Fi/cellular/network transitions,
  foreground/background recovery, reconnect, TURN, and room expiry.

Do not claim final acceptance until those exact-head gates have actually run.

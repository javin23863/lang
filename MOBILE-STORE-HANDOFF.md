# Lingua Relay mobile-store handoff — historical receipt

Status date: 2026-08-14.

> **Historical evidence only.** This file records the August 14 closed-beta
> deployment/build receipt and one-time store setup notes. It is not evidence
> for the current development head and must not be used to claim current CI,
> signed-build, deployment, or physical-device acceptance.
>
> The current Version 1.0 product boundary is
> [`RELEASE-1.0.md`](RELEASE-1.0.md). Current implementation and release-gate
> status is [`wa-translator/mobile/LAUNCH-CHECKLIST.md`](wa-translator/mobile/LAUNCH-CHECKLIST.md).
> Historical four-person/accountless assumptions are superseded: Version 1.0 is
> exactly two joined participants, hosts authenticate to create rooms, guests do
> not need accounts, and Version 1.0 is non-monetized.

## What this receipt established on August 14

- A Capacitor 8 application named **Lingua Relay** existed for Android and iOS.
- Bundle/application ID: `com.javin23863.linguarelay`.
- Native builds used bundled web assets rather than a remote-site wrapper.
- Cloudflare remained the room/signalling service and Modal remained remote
  speech/translation/optional-voice compute.
- Android/iOS secure storage, App/Universal Link plumbing, native sharing,
  foreground camera/microphone behavior, public legal pages, category-only
  reporting, unsigned build automation, and beta upload scaffolding were present.
- The dated browser/build probes and artifact hashes below were useful evidence
  for that historical commit only.

## Historical beta receipt — 2026-08-14 11:04 +07

Public origin at the time:

`https://spoken-translation-room.spoken-translation-cloudflare.workers.dev`

Historical Worker version:

`f2c94502-82f3-4281-809f-3aed424bb25b`

Historical runtime source:

`b7b0fffdd41816b45cf0e1ee53893b6802d75853`

The dated acceptance probe reported health/bootstrap/room/report/moderator-close
success and the browser acceptance exercised language UI, RTL layout, WebRTC,
permissions, device speech, translated WAV playback, sharing, and Leave.

Historical GitHub Actions run `31769087455` passed its Android, iOS, and product
regression jobs on that earlier source. The archived Android AAB receipt was
3,095,207 bytes with SHA-256
`C9D1196739A69B6CCC7738DFE292051EF568FCA83CE3C3A4F498E4C1FCA3296E`.
The unsigned iOS executable receipt was 441,048 bytes with SHA-256
`232F76EFE5B106FF977493924F5B5C6FA68E0BB4FD0400E90B7487B046C4B120`.

These values are intentionally retained as provenance. They do **not** describe
the current branch or satisfy the final Version 1.0 exact-head verification
matrix.

## Current development commands

From `wa-translator/mobile`:

```text
npm ci
npm run check
npm run assets
npm run sync
```

Do not run signed/release workflows merely because these source commands exist.
The final exact-head credential-free and signed matrices are explicit release
gates in `LAUNCH-CHECKLIST.md`.

## Store/operator setup that remains conceptually valid

### Google Play

The account owner must verify the Play Console developer account, create the app
for package `com.javin23863.linguarelay`, enable Play App Signing, provide the
release service-account access and protected signing/upload secrets, and place
the **Play App Signing** SHA-256 certificate fingerprint—not merely an upload-key
fingerprint—into the production association configuration.

Signed automation should stop at Play Internal Testing until the release owner
approves later rollout.

### Apple

The account owner must verify Apple Developer/App Store Connect, register bundle
ID `com.javin23863.linguarelay` with Associated Domains, provide the final Team
ID and App Store Connect/signing credentials, and run the signed build through
TestFlight before production submission.

The live iOS provider surface must include Sign in with Apple whenever other
third-party sign-in is offered.

### Moderation

A monitored operator must own the private category-only report queue throughout
beta/public availability. The current repository includes the private moderation
CLI/runbook; credentials remain outside Git. Public launch is blocked until a
real owner/on-call schedule is assigned and the live private queue is verified.

## Current submission sources

Use the current hierarchy rather than this historical handoff:

1. `RELEASE-1.0.md` — product contract.
2. `wa-translator/mobile/LAUNCH-CHECKLIST.md` — current gates/status.
3. `wa-translator/mobile/STORE-DECLARATIONS.md` — store/privacy answers.
4. `wa-translator/mobile/REVIEW-INPUTS.md` — owner-supplied review inputs.
5. `wa-translator/mobile/fastlane/metadata` and screenshot directories — store
   listing assets.
6. Current runtime code/tests and `CLOUD-ARCHITECTURE.md` — implementation.

## Current launch boundary

No historical CI run or browser acceptance replaces final release acceptance.
Before public submission, the exact final development commit must complete:

- the full credential-free test/build matrix;
- signed Android Internal and iOS TestFlight workflows;
- live provider/deep-link/account-deletion preflight;
- real Android-to-iPhone testing of account/auth, links, camera/microphone,
  foreground/background recovery, reconnect, TURN, captions, optional translated
  voice, network changes, and room expiry;
- final App Store/Play privacy, content/rating/export, app-access/reviewer, and
  moderation/support ownership gates.

Store approval cannot be automated or guaranteed.

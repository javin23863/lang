# Lingua Relay — current developer handoff

Status date: **2026-08-26 +07**.

This is the current continuation handoff for the Lingua Relay product work. It is
written so a new developer can open the repository, identify the correct branches,
understand what is actually implemented and tested, and continue toward a real
Android/iOS/public-web launch without reconstructing the last several development
passes from chat history.

This document deliberately excludes only the **act/cost of enrolling in or paying
for the Apple Developer Program and Google Play developer account**. Everything
technical, operational, console, signing, testing, deployment, support, moderation,
and release work that still remains after those accounts are available is listed
below.

Version 1.0 itself is **non-monetized**. Do not add subscriptions, StoreKit products,
Google Play Billing, credits, ads, or another payment model as part of this launch.

## Read this first, then these files

The current continuation order is:

1. `RELEASE-1.0.md` — authoritative Version 1.0 product boundary. If another
   document conflicts with it, this file wins.
2. `CURRENT-DEVELOPER-HANDOFF.md` — current branch/test/deployment continuation
   state and exact next actions.
3. `wa-translator/mobile/LAUNCH-CHECKLIST.md` — authoritative implemented-vs-open
   launch gate checklist.
4. `PRODUCT-TEST-HANDOFF.md` — earlier 2026-08-26 product-testing checkpoint. It
   remains useful history, but its statement that exact-head CI had not run is now
   superseded by the receipts in this document.
5. `wa-translator/mobile/STORE-DECLARATIONS.md` — store/privacy declarations.
6. `wa-translator/mobile/REVIEW-INPUTS.md` — owner-supplied review/support inputs;
   secrets must never be committed.
7. `CLOUD-ARCHITECTURE.md`, runtime code, and tests — implementation detail.

Older `MOBILE-STORE-*`, `MULTILINGUAL-PRODUCT-HANDOFF.md`, and `SPEC-v*` documents
are historical/research material unless explicitly updated to reference the active
Version 1.0 contract.

## Branches and exact checkpoints

### Canonical product branch

`product/app-shell-tabs-20260826-v2`

Implementation head immediately before this handoff documentation:

`c998d5afa745fe74e3a1bde98af7977448cc7373`

This is the branch that contains the current product/UI implementation and should
remain the canonical development source while the prelaunch validation work is
reconciled back into it deliberately.

### Exact prelaunch validation branch

`prelaunch/product-test-20260826`

**Do not advance this branch before completing or abandoning the current exact-SHA
staging rendezvous.** Its frozen validation head is:

`753f719c0ff6d9a9e3d684a4aea28989c49219aa`

The staging-target Android APK build and the guarded Cloudflare staging workflow
are designed to meet on that literal SHA. Moving the branch head first would make
the manual staging workflow's `github.sha` differ from the APK source and would
correctly fail the identity check.

The product and prelaunch branches currently **diverge from the same older merge
base** because several staging/native validation fixes were committed independently
on each branch while keeping the prelaunch event SHA testable. Do not blindly merge
one history into the other. Reconcile by file/content or carefully cherry-pick the
missing deltas after the staging checkpoint is complete.

### `main`

Current `main` at this handoff is still:

`4c8d65b072d9d40757d24b2f6293b4bb1665b696`

It is substantially behind the current product work and must not be treated as the
current Lingua Relay application implementation.

## What the product actually is now

Lingua Relay is an integrated **two-person, foreground multilingual conversation
product**, not a collection of mockups.

The Version 1.0 user model is:

- one signed-in host creates a private room;
- one invited participant joins the signed HTTPS invitation without an account;
- exactly two joined participants are allowed;
- Video, Voice, and Chat are presentations of the same private room lifecycle;
- camera and natural audio use WebRTC;
- translated captions and optional translated voice use the authenticated
  speech/translation compute path;
- rooms are foreground-only and expire no later than 24 hours;
- there is no conversation-history product, call recording, public discovery,
  stranger matching, advertising, analytics SDK, or Version 1.0 monetization.

### Current host/product UI

The current product surface includes:

- Home, Activity, Languages, and Profile tabs;
- first-run/preferences behavior;
- saved preferred Video / Voice / Chat mode;
- saved conversation language pair;
- Quick Start derived from those preferences;
- Video, Voice, and Chat setup flows;
- functional Swap languages behavior in setup and Languages;
- room-ready state with mode-aware enter/open actions;
- account/profile/logout/delete-account controls backed by the real account model;
- post-conversation actions to repeat the same mode or return Home.

### Invitation/waiting experience

The host has a dedicated **Invite person** sheet backed by the existing real room
bearer. It includes:

- QR code;
- system Share;
- Copy Link;
- browser WhatsApp and LINE actions;
- current language pair;
- current mode;
- Waiting / Connected presentation.

The implementation intentionally reuses the existing room URL and sharing model.
It does not create a parallel invitation/session contract. QR content is rendered
only while the invitation sheet is active. The old duplicate raw-link/share
presentation is hidden from the host card while its established backing controls
remain available to the sharing implementation.

### Guest pre-join and room flow

Before joining:

- Video performs a local camera preview plus live microphone-level check;
- Voice performs a local microphone-level check;
- Chat explicitly states that no camera/microphone test is required.

Those checks are local-only and do not join the room early.

Once joined, the current room supports the existing two-person media/signalling
contract, translated captions, translated voice where supported, and translated
text chat. Ending/leaving exposes the current post-conversation continuation
surface.

### Native application

The native app lives under `wa-translator/mobile` and uses Capacitor 8 with app ID:

`com.javin23863.linguarelay`

It bundles reviewed web assets locally. It is not a remote-website wrapper.

Native seams already implemented include:

- Android App Links / iOS Universal Links for room invitations;
- app-only OAuth return scheme;
- system-browser OAuth handoff;
- nonce-bearing `s2` sessions for new browser/native sessions;
- one-time app-bound native auth handoff;
- Keychain/Keystore-backed secure storage;
- native share sheet;
- foreground/background lifecycle handling;
- protocol/build/public-origin/two-participant bootstrap validation that fails
  closed on an incompatible backend.

## Backend and compute architecture that is already in place

### Cloudflare

Cloudflare Worker + Durable Objects own:

- account/session integration;
- room creation/lifetime/ownership;
- strict two-person admission through the shipping wrapper;
- signalling;
- host control;
- TURN credential issuance;
- bounded abuse controls;
- category-only private report queue;
- public web/legal/support assets;
- versioned native compatibility/bootstrap and auth-handoff surfaces.

Production shipping entrypoints go through the guarded wrapper chain. The base
`wa-translator/cloudflare/src/worker.ts` still contains historical pre-Version-1.0
four-person behavior. **Do not deploy/export that base Room directly.** This is
known structural debt, not a reason to rewrite the shipping path before launch.

### Modal

Modal remains the authenticated ASR / machine-translation / optional translated-
voice compute plane. Per-container admission and scale configuration are bounded,
and development defaults preserve the scale-to-zero cost posture. Before raising
production GPU ceilings, retain measured latency, memory, scale-out/recovery, and
cost receipts for the exact proposed production configuration.

## Exact-source/staging work completed in the latest pass

The latest validation pass closed the gap between “source builds” and “we can
prove which exact source a test backend/native package came from.”

### Staging Worker release identity

A staging-only entry wrapper now adds an immutable `release_sha` identity to the
mobile/bootstrap and capability surfaces. Staging fails closed if the injected SHA
is missing or malformed.

Production keeps its existing shipping entrypoint; the release-identity wrapper is
staging-specific.

`wrangler.staging.jsonc` uses the isolated staging Worker/DO namespace and contains
a `__RELEASE_SHA__` placeholder. The guarded staging GitHub workflow replaces that
placeholder with the exact dispatched commit before deployment.

### Guarded manual staging deployment

`.github/workflows/cloudflare-staging.yml` is intentionally **manual-only** via
`workflow_dispatch`.

It requires an exact 40-character `release_sha` and rejects the run unless:

- the dispatch ref resolves to that same SHA;
- checkout `HEAD` is that same SHA;
- Cloudflare checks pass;
- staging credentials are available;
- the live deployed bootstrap later reports the same `release_sha`.

Do not add automatic `push:` deployment to this workflow. Repository tests
explicitly protect the manual-deploy boundary for staging/production/rollback.

### Native production/staging target seam

The native build now supports only two allowed backend targets:

- the canonical production Worker origin; or
- the isolated staging Worker origin.

Production remains the default. Arbitrary origins are rejected.

The bridge build writes `www/native-build-target.json`, and native association sync
uses the same selected target so Android/iOS link associations cannot silently point
at production while the bridge points at staging.

### Exact-source staging APK workflow

`.github/workflows/prelaunch-staging-apk.yml` now:

1. checks out the literal event SHA;
2. runs mobile checks;
3. syncs the native shell to the staging origin;
4. verifies the packaged staging target and Android association host;
5. builds a directly installable debug APK;
6. verifies its signature;
7. polls the public staging bootstrap until it reports the **same Git SHA**;
8. only then writes `staging-apk-receipt.txt` and uploads
   `lingua-relay-exact-source-staging-apk`.

This means an APK can compile successfully but still cannot be called an
“exact-source staging artifact” until the live backend proves identical source
identity.

### Other defects found and fixed while building the gate

The prelaunch validation work also found and corrected:

- the mobile `typecheck` script had been lost; `tsc --noEmit` was restored;
- Android emulator smoke initially created the AVD outside the emulator lookup
  location; the harness now uses a shared explicit `ANDROID_AVD_HOME`;
- the native backend build selector was initially not TypeScript-safe; it was
  reworked while preserving the canonical production-origin audits;
- production/staging origin tests now assert the constrained resolver rather than
  a one-origin implementation detail;
- native platform association sync was aligned to the selected build target;
- the environment verifier now explicitly recognizes the staging-only release
  wrapper while keeping production pinned to the normal shipping entrypoint;
- the deployment-smoke fixture now supplies and verifies an exact release SHA
  rather than exercising staging without the identity staging requires.

## Validation receipts at handoff

### Exact prelaunch SHA

`753f719c0ff6d9a9e3d684a4aea28989c49219aa`

### Credential-free product/mobile matrix

GitHub Actions run:

`https://github.com/javin23863/lang/actions/runs/32974526911`

Status at handoff: **completed / success**.

That exact run includes:

- Cloudflare/product regression: success;
- Cloudflare `npm run check`: success;
- Python language/cloud-client/latency/live-bilingual/multilingual regression
  fixtures: success;
- mobile checks: success;
- Android release AAB build and verification: success;
- directly installable Android test APK build and signature verification: success;
- unsigned iOS Release build and artifact verification: success.

### Native launch smoke

GitHub Actions run:

`https://github.com/javin23863/lang/actions/runs/32974526956`

On exact SHA `753f719c...`:

- Android API 36 emulator launch: **completed / success**, receipt uploaded;
- iOS simulator job was still executing at the time this handoff was written.
  Recheck this run before making an exact-SHA iOS native-launch claim.

Earlier development runs did successfully launch the packaged iOS app in an iOS
simulator, but the exact `753f719c...` result is the one that matters for this
checkpoint.

### Staging-target APK gate

GitHub Actions run:

`https://github.com/javin23863/lang/actions/runs/32974526894`

On exact SHA `753f719c...`, the following steps have already passed:

- exact source checkout;
- mobile checks;
- staging-target native sync;
- packaged staging-target verification;
- installable staging APK build;
- staging APK signature verification.

The job is intentionally stopped at `Wait for exact-source staging backend` until
the isolated staging Worker reports:

`release_sha = 753f719c0ff6d9a9e3d684a4aea28989c49219aa`

At handoff there had been **no manual Cloudflare staging workflow dispatch** for
this prelaunch branch/SHA, so no final staging APK receipt or artifact upload should
be claimed yet.

### Older directly installable Android artifact

An earlier production-target test APK was built and signature-verified during this
product wave. Its recorded SHA-256 was:

`7a307fc5f89fee41fe17ffcda34203681011f775c88a858341e0c3df5261632d`

Treat it only as an earlier production-target development artifact. It is **not**
the exact-source staging APK described above.

## Immediate resume sequence — do this before unrelated work

### 1. Preserve the frozen prelaunch SHA

Do not commit to `prelaunch/product-test-20260826` until the current staging
rendezvous has either completed or been deliberately abandoned.

Expected SHA:

`753f719c0ff6d9a9e3d684a4aea28989c49219aa`

### 2. Manually deploy the isolated staging Worker at that exact SHA

In GitHub Actions:

- workflow: **Cloudflare staging**;
- ref/branch: `prelaunch/product-test-20260826`;
- input `release_sha`:
  `753f719c0ff6d9a9e3d684a4aea28989c49219aa`.

The workflow must pass its exact-commit check, Cloudflare checks, deployment, and
live `release_sha` smoke. If credentials are missing, configure the staging
GitHub Environment/secrets; do not put them in the repository.

### 3. Complete or rerun the staging APK workflow

If run `32974526894` is still polling when staging becomes live, it should detect
the matching SHA and proceed. If it has timed out, rerun the exact staging-APK job
for the same `753f719c...` source after staging is live.

Success means the workflow writes an APK digest/source/origin receipt and uploads
`lingua-relay-exact-source-staging-apk`.

### 4. Recheck exact-SHA iOS simulator smoke

Recheck run `32974526956`. If the exact-SHA iOS job failed, classify the simulator
or app failure and fix it without weakening the launch gate. If it passed, preserve
the receipt.

### 5. Produce an iOS staging-target test build

The build-time origin seam now supports staging, but the dedicated
`prelaunch-staging-apk.yml` artifact is Android-only. Add or adapt an iOS staging
validation path so an iOS simulator/device package is built with
`LINGUA_PUBLIC_ORIGIN` set to the same isolated staging origin and verify its
associated-domain target before treating two-device staging as exact-source.

### 6. Exercise the actual product end to end

Use staging, one signed-in host, and a separate guest device/browser. Verify Video,
Voice, and Chat through the real room model, not isolated UI pages.

## Remaining work before a real consumer beta/release

The items below intentionally exclude only paying/enrolling for the Apple/Google
developer programs. They do **not** exclude the technical/console work that follows.

### A. Reconcile the canonical source branches

After the exact staging checkpoint is complete:

- compare `product/app-shell-tabs-20260826-v2` with
  `prelaunch/product-test-20260826` by file/content;
- bring the final staging release-identity, native target, harness, workflow, and
  smoke-fixture changes back into the canonical product line;
- avoid a blind history merge because equivalent fixes were committed independently
  on both branches;
- create a clean release-candidate/prelaunch branch from the reconciled product
  source;
- freeze one exact release-candidate SHA and use that SHA for every later source,
  deployment, signed-build, screenshot, and device receipt.

`main` should only be updated through the repository's normal reviewed integration
path after the product/release source is coherent. Do not treat the old `main`
head as a release candidate.

### B. Exact staging environment acceptance

- complete the exact-SHA staging deployment/live identity proof;
- verify `/health` and `/api/v1/mobile/bootstrap` on staging;
- verify the staging bootstrap's protocol, public origin, account mode, foreground
  lifecycle, two-participant cap, minimum client build, and exact `release_sha`;
- verify Privacy, Terms, Support, and account-deletion pages from staging;
- run the authenticated browser journey against staging with a dedicated test host;
- verify two-participant WebSocket signalling and TURN behavior against staging;
- verify Modal ASR/MT/TTS integration with the staging Worker rather than only
  local/mock fixtures;
- capture staging telemetry/log correlation for failed and successful room flows.

### C. Full functional product acceptance

On real browser/device combinations, verify:

- host sign-in and account creation/refresh;
- logout and independent-session revocation behavior;
- account deletion and owned-room shutdown;
- Home / Activity / Languages / Profile;
- saved preferred mode and language pair;
- Quick Start;
- language Swap;
- Video setup and room;
- Voice setup and room;
- Chat setup and room;
- Invite person sheet;
- QR, system Share, Copy Link, WhatsApp/LINE where applicable;
- guest account-free entry;
- Video camera + microphone pre-join test;
- Voice microphone pre-join test;
- Chat no-media pre-join state;
- Waiting → Connected presentation;
- natural WebRTC audio/video;
- translated captions;
- optional translated voice;
- translated text chat;
- block participant;
- category-only report and current-room closure;
- Terms acceptance behavior;
- end/leave/repeat conversation;
- room close and room expiry;
- third-participant rejection.

### D. Physical Android/iPhone matrix

Run representative physical-device acceptance, not only emulators/simulators:

- Android host → iPhone guest;
- iPhone host → Android guest;
- Android ↔ Android where practical;
- iPhone ↔ iPhone where practical;
- camera/microphone initial permission;
- permission denial;
- revoke/regrant while app is installed;
- app foreground/background transitions;
- interruption and restoration;
- Wi-Fi only;
- cellular only;
- Wi-Fi ↔ cellular transition;
- constrained/poor network;
- reconnect;
- TURN-relayed path where direct peer connectivity is unavailable;
- room expiry and stale-link behavior;
- app cold start from room link;
- app cold start from OAuth return;
- duplicate/replayed native handoff rejection;
- share sheet and QR interoperability between real devices.

### E. Production origin and infrastructure

Select the actual public production origin. A branded domain is preferred by the
current launch checklist, but do not invent one in source before the operator has
chosen/configured it.

Then:

- update the canonical production-origin configuration;
- deploy/verify the same origin across Worker bootstrap, Android associations,
  iOS associations, OAuth callbacks, legal URLs, deletion URL, and store records;
- provision all required Cloudflare secrets and Durable Object configuration;
- provision/verify Modal production deployment settings and secret integration;
- verify TURN credentials/service for the production environment;
- verify production logs/telemetry access;
- exercise the documented protected rollback workflow using a safe rehearsal;
- run production smoke only from the exact frozen release source after staging is
  accepted.

### F. OAuth/provider production setup

#### Google

After the developer/account access exists:

- create/configure the live Google OAuth application/client(s);
- register the exact production callbacks/origins required by web/native flow;
- install client secrets only in the approved secret store/environment;
- verify browser sign-in;
- verify Android native sign-in return;
- verify iOS native sign-in return if Google is offered there;
- verify logout, revoked session, deleted account, and repeated login behavior.

#### Apple

After Apple developer access exists:

- create/configure the required App ID / Services ID relationship;
- establish the real Team ID;
- create the required Sign in with Apple key/Key ID/private key;
- configure exact production return URLs/domains;
- place private material only in the approved secret store;
- verify the live `/api/v1/me` provider list includes `apple` before iOS submission
  if Google/Facebook sign-in is exposed;
- exercise first-login one-time Apple `user` data behavior and later login behavior;
- exercise real Apple sign-in on a physical iPhone/TestFlight build.

#### Facebook

Facebook is optional for Version 1.0. Configure and validate it only if it is
intentionally offered at launch. Its absence must not block a Google/Apple launch.

### G. Android signing and verified links

After Play developer access/signing identity exists:

- establish Play App Signing/release signing strategy;
- create/protect the upload key as required;
- record the real release certificate SHA-256 fingerprint outside source secrets;
- publish/verify production `assetlinks.json` with the actual release signing
  certificate fingerprint;
- build the signed release AAB from the exact frozen source;
- verify package ID `com.javin23863.linguarelay`, versionCode, permissions,
  signing identity, packaged assets, and production backend target;
- upload only through the guarded Play Internal workflow/path;
- install the Play Internal build on real Android devices and repeat the physical
  lifecycle matrix.

### H. iOS signing, entitlements, and Universal Links

After Apple developer/signing access exists:

- create/configure the production app record/bundle identifier
  `com.javin23863.linguarelay`;
- establish the actual Apple Team ID and signing identity/profiles;
- publish/verify AASA for that Team ID + bundle ID and `/room/*`;
- verify associated-domains entitlement and app-only OAuth return scheme in the
  signed package;
- build the signed IPA from the exact frozen source;
- verify CFBundleVersion, signing identity, privacy manifest, usage descriptions,
  permissions, packaged assets, and production backend target;
- upload through the guarded TestFlight path;
- install TestFlight on representative real iPhones and repeat the physical
  lifecycle matrix including real Apple sign-in.

### I. Public support, moderation, and operational ownership

Before public store submission:

- create a dedicated public product-support email/contact rather than exposing a
  developer's source-control identity;
- publish that contact on the production `/support` page;
- supply any legal address/phone information required for target distribution
  countries;
- confirm the support contact is monitored;
- define a private access-loss/account-support process;
- assign a monitored moderation/on-call owner;
- verify the private category-only moderation queue;
- run a moderation closure drill against a disposable room;
- verify production report-admin credentials stay outside Git;
- define who owns incident response, rollback, provider outage, and store-review
  communication during beta/launch.

### J. Store listing/review work after account access exists

The repository already contains listing assets/metadata scaffolding and declarations,
but the consoles still require operator input.

#### App Store Connect

- create/finalize the app record;
- enter final app name/subtitle/description/keywords/category as appropriate;
- enter the exact production Privacy, Terms/Support where requested, and account
  deletion/support URLs;
- complete age-rating questions from actual final behavior;
- complete export-compliance/encryption questions from the actual signed build;
- complete privacy declarations from `STORE-DECLARATIONS.md` and final behavior;
- provide App Review contact name/email/phone;
- provide a non-expiring review/demo OAuth identity and provider-specific SSO
  instructions directly in App Store Connect, never in Git;
- provide review notes explaining the private two-person invite model, account
  deletion, safety/block/report flow, and permission behavior;
- provide TestFlight feedback email;
- upload the exact accepted signed build;
- complete internal/external TestFlight acceptance before production submission.

#### Google Play Console

- create/finalize the app record;
- enter final title/descriptions/category and accepted screenshots/graphics;
- enter final privacy/support/account-deletion URLs;
- complete Data safety from the final accepted behavior;
- complete target audience/content rating/ads/App content declarations;
- enter app-access instructions and a real review/demo OAuth identity directly in
  Play Console;
- explain the private two-person invite model, deletion, block/report flow, and
  guest account-free entry;
- configure Play App Signing/upload identity and service-account automation as
  required by the guarded workflow;
- upload the exact accepted AAB to Play Internal first;
- complete internal physical-device acceptance before production submission.

### K. Screenshots and final store evidence

Do not promote old screenshots simply because they exist.

- run the exact-head browser capture journey against the accepted final source;
- require its screenshot provenance/manifest to pass;
- recapture the final Home/setup/invite/guest/room/post-call states from the
  accepted UI;
- ensure screenshots match the exact product behavior submitted to stores;
- update store graphics only after final UX/source freeze.

### L. Performance and operational receipts

Before raising compute limits or making stronger performance claims:

- measure translation/caption/voice latency against the exact production-like
  configuration;
- measure Modal container memory and concurrency behavior;
- measure cold-start/scale-out/recovery behavior;
- validate cost at the intended warm-floor/max-container configuration;
- exercise TURN/reconnect behavior under real network transitions;
- verify Cloudflare/Modal failure paths stay bounded and fail closed;
- retain release-linked receipts rather than relying on historical measurements.

If Version 1.0 launches with the current conservative GPU defaults, raising GPU
ceilings is not itself a launch requirement; the measurement gate becomes required
before increasing those limits.

### M. Final release-candidate acceptance

After all product/configuration changes are frozen:

- select one exact final commit;
- run the complete credential-free Worker/product/mobile matrix on that literal
  commit;
- deploy exact-SHA staging and pass live SHA/contract smoke;
- run the full browser/staging acceptance;
- run signed Play Internal and TestFlight workflows from that same commit;
- verify Android/iOS signed package identities and associations;
- complete representative physical-device acceptance;
- verify live Google and Apple auth;
- verify public Privacy/Terms/Support/deletion surfaces;
- verify moderation/support ownership;
- complete both stores' final privacy/rating/access/export/review forms;
- preserve build/deploy/device/screenshot receipts tied to the same release SHA;
- only then promote/submit the release.

## Local developer commands

### Cloudflare development Worker

From `wa-translator/cloudflare`:

```text
npm ci
npm run check
npx wrangler dev -c wrangler.dev.jsonc --port 8788 --local
```

### Browser automation

The browser runner requires a dedicated signed-in test host and its current `s2`
session value in `LINGUA_SESSION`.

```text
set LINGUA_SESSION=<dedicated-test-host-s2-session>
node wa-translator/tools/browser/run.mjs
```

Use the equivalent environment-variable syntax on non-Windows shells.

### Native source checks/sync

From `wa-translator/mobile`:

```text
npm ci
npm run check
npm run assets
npm run sync
```

Production is the default native backend. For deliberate staging builds, use only
the repository's constrained `LINGUA_PUBLIC_ORIGIN` staging target; arbitrary
origins intentionally fail.

## Critical stop signs for the next developer

- Do **not** change the Version 1.0 room model to four-person/group rooms.
- Do **not** add monetization for Version 1.0.
- Do **not** deploy the historical base `worker.ts` Room directly.
- Do **not** auto-deploy staging/production on every push; guarded deployment is
  deliberate.
- Do **not** advance `prelaunch/product-test-20260826` before resolving the
  `753f719c...` staging rendezvous.
- Do **not** call an APK “exact-source staging” until the live Worker reports the
  identical `release_sha` and the workflow writes/uploads its receipt.
- Do **not** treat unsigned emulator/simulator compilation as signed beta/device
  acceptance.
- Do **not** treat historical August receipts as proof of the current product.
- Do **not** put OAuth secrets, Apple keys, signing material, reviewer passwords,
  Play service-account JSON, report-admin tokens, TURN secrets, or private support
  data in Git.
- Do **not** use a developer's personal Git identity as the public support contact.
- Do **not** enter current development Worker URLs into final store records without
  explicitly deciding that origin is the final production origin and revalidating
  every association/callback.

## Definition of “we have a testable product” vs “we are launch ready”

**Integrated development product:** yes.

**Exact-SHA credential-free product/mobile matrix:** yes on prelaunch SHA
`753f719c...` via run `32974526911`.

**Android exact-SHA emulator launch:** yes on `753f719c...`.

**Staging-target Android APK builds and verifies:** yes.

**Exact-source live staging backend + APK receipt:** not yet; manual staging
workflow dispatch is the current boundary.

**Exact-SHA iOS simulator receipt on `753f719c...`:** recheck the still-running
native-smoke job before claiming it.

**Real two-device Android/iPhone staging acceptance:** not yet.

**Signed Play Internal/TestFlight acceptance:** not yet.

**Production exact-source deployment acceptance:** not yet.

**Public-store ready:** not yet.

The immediate next milestone is therefore not another UI redesign or detached
hardening pass. It is: **complete the exact-SHA staging rendezvous, produce both
platforms against that isolated backend, run the real two-device end-to-end product
matrix, reconcile the validation changes into one canonical release source, and
then move through production/signing/store gates on one frozen commit.**

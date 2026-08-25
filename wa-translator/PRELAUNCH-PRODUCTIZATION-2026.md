# Lingua Relay — 2026 pre-launch productization plan

Status: active follow-on work after exact-head acceptance of `f43410267bc28cbc7791189f9f2da3055e195bef`.

This branch intentionally excludes paid Apple Developer / Google Play Console credentials, signed store upload, and physical-store beta acceptance until those accounts and credentials exist. It covers source, product, reliability, deployment, QA, and store-preparation work that can be completed before that boundary.

## Current progress checkpoint — 2026-08-25

Implementation checkpoint: `e12e9f2e661533129507eda54e26cbd0f02da804` on `prelaunch/productization-2026`.

PR: #13, `Pre-launch 2026: productization and observability`, remains draft and targets `fix/mobile-p0-remediation`. Do not merge it ahead of PR #11.

CI evidence:

- Mobile build #491 / run `32849589544`: fully green across `product-regression`, Android release AAB build/verifier, and unsigned iOS Release build/verifier.
- Mobile build #498 / run `32850400348`: diagnostic failure caused only by an overbroad source assertion in the newly added browser-acceptance contract; product regression itself remained green.
- Mobile build #499 / run `32850821729`: fully green after the assertion was made behavior-aware. `product-regression`, Android, and iOS all passed, including native sync and release-artifact verification.

Browser acceptance source has also been brought up to the current security/product contract:

- it no longer forges a host session from `ROOM_SIGNING_KEY`;
- it requires a current external `s2` session belonging to a live account in the Worker being exercised;
- it no longer stubs `/api/me`;
- room journeys prove Terms starts unchecked with Join disabled, then explicitly accept the current Terms before joining;
- host, guest, and two-browser journeys share that affirmative-consent helper;
- a repository regression test pins those assumptions.

The live real-browser run itself is **not yet accepted**. It needs a dedicated test host signed into the target Worker so `LINGUA_SESSION` can contain that account's current `s2` browser session. No live browser, staging, production, signed-store, or physical-device result is claimed by this checkpoint.

## Product architecture decision

Keep the current **Capacitor + Cloudflare Workers/Durable Objects + web UI** architecture unless measured product requirements prove that the web/native bridge is the limiting factor.

Do not rewrite to Expo/React Native merely because it has a larger starter ecosystem. The product already has a tested security/session model, two-person room authority, native bridge, deep links, release verifiers, localization, and exact-head CI. A framework rewrite would reset much of that evidence without improving the product by itself.

Use current 2026 starters as a benchmark for practices instead:

- Infinite Red Ignite: long-lived Expo/React Native boilerplate with TypeScript, navigation, localization, persistence, generators and testing. <https://github.com/infinitered/ignite>
- Capstart: web-first React + Vite + TypeScript + Capacitor starter/tooling, including migration of existing web projects. <https://github.com/AdrienADV/capstart>
- Expo App Template: feature-based consumer app example with capability-gated integrations, typed analytics, onboarding/auth and production configuration checks. <https://github.com/Simonstorms/expo-app-template>
- Expo Forge: feature/design-system structure with optional analytics, observability, payments and validated environment configuration. <https://github.com/abed42/expo-forge>
- React Native Boilerplate: comparison point for the common Sentry/PostHog/RevenueCat/notifications/i18n productization bundle. <https://github.com/reactnative-boilerplate/react-native-boilerplate>

The operating rule remains: **borrow the operating model, not the framework**.

## North-star activation event

A new user is not activated when the app is installed, opened, or when a room is merely created.

For v1, activation is:

> A host creates a private two-person room, successfully gets the invite to the other participant, the other participant joins, and the pair completes a useful translated interaction.

The product funnel must identify where users fail before that point without collecting room bearer URLs, names, email addresses, message text, captions, transcripts, or translation content.

The vendor-neutral `lingua:product-event` seam now covers host intent/result events plus room-side activation events including `room.join.intent`, `room.pair.ready`, `translation.first.result`, and coarse `network.state`. It performs no network transmission or persistence.

## Phase A — foundation and operability

### A1. Observability

- [x] Upload Worker source maps.
- [x] Enable Workers Logs.
- [x] Keep automatic invocation URL logging disabled while room URLs are capability-bearing.
- [x] Add regression guards for the observability/privacy configuration.
- [x] Define first-party structured operational event names for request success/failure/exception states.
- [x] Add random request correlation IDs that do not derive from account identity, room credentials, or IP identity.
- [x] Define the control-plane, signalling, translation, durable-state, and moderation metric/query contract in `SLO-OPERATIONS.md`.
- [x] Define pre-baseline alert classes and incident/rollback sequence.
- [ ] Instantiate the documented dashboards/saved queries in the real Cloudflare environment after representative staging traffic exists.
- [ ] Set numeric SLO/alert thresholds only after representative staging/device measurements exist.

### A2. Environments

- [x] Separate local, staging, and production Worker configuration as explicit targets.
- [x] Give staging a distinct Worker name, origin, and Durable Object namespace.
- [x] Add fail-closed environment validation for shipping entrypoints, bindings, origins, observability, and committed credential placeholders.
- [x] Add exact-SHA staging promotion, production promotion, and production rollback workflows.
- [x] Document immutable-SHA promotion, post-deploy smoke, release receipts, and rollback in `CLOUDFLARE-OPERATIONS.md`.
- [ ] Provision the `cloudflare-staging` and `cloudflare-production` GitHub environments and protected credentials.
- [ ] Configure non-production OAuth/provider credentials for staging when those provider accounts are available.
- [ ] Run and retain the first live staging deployment/smoke receipt.
- [ ] Run production deployment only after staging acceptance and deliberate approval.

### A3. Product telemetry contract

- [x] Add a vendor-neutral allowlisted event schema.
- [x] Reject identity/content/capability-shaped fields.
- [x] Keep the base event seam network- and storage-free.
- [x] Wire safe host intent events into the dashboard.
- [x] Emit host operation results at real API/controller boundaries.
- [x] Add guest join, pair-ready, first-translation-result, and coarse network-state events without participant identifiers.
- [x] Add onboarding view/completion events without identity data.
- [ ] Choose and enable any third-party analytics transport only after privacy/store-declaration review. Application call sites must remain vendor-independent.

## Phase B — frontend product architecture

The shipping application remains deliberately incremental rather than a framework rewrite. Existing security and behavior tests remain the contract while features are decomposed.

### B1. Shared design system

- [x] Centralize semantic design tokens for surfaces, text, brand, status, spacing, radius, elevation, focus, touch target, typography, and motion.
- [x] Support system light/dark appearance and reduced-motion behavior.
- [x] Apply shared button/field/card/status patterns to the dashboard and mobile-prepared surface.
- [x] Preserve safe areas, RTL, small-phone widths, landscape behavior, and localized-content wrapping contracts.
- [x] Add deterministic source/DOM accessibility and responsive assertions.
- [ ] Add image-diff visual-regression baselines on representative real browser/device renderers; store screenshots are not a substitute for that regression layer.

### B2. First-run onboarding / activation

- [x] Explain the core private two-person host/invite/join flow on first run.
- [x] Present video, voice, and chat modes using translated product copy.
- [x] Defer microphone/camera prompts until the explicit feature action that needs them.
- [x] Make the host-account / accountless-invited-guest boundary explicit.
- [x] Route returning users around completed onboarding.
- [x] Persist onboarding completion locally only.
- [x] Emit local privacy-safe onboarding progression events.

### B3. Dashboard decomposition

Completed behind behavioral tests:

- [x] API/deadline client.
- [x] Account/auth presenter.
- [x] Room creation/control model and controller.
- [x] Share/invite presenter.
- [x] Usage/settings lifecycle.
- [x] Boot/lifecycle coordinator and recovery behavior.

### B4. Room experience redesign

- [x] Separate connection/network state from participant and translation state presentation.
- [x] Carry explicit reconnecting/rejoining/expired/closed/full/update-required and degraded media states.
- [x] Improve permission-denied/track-ended recovery for microphone and camera.
- [x] Enforce touch-target, overflow, narrow-phone, RTL, and localized-content layout contracts.
- [x] Make foreground/background and network interruption recovery understandable through user-facing states rather than transport details.
- [x] Preserve report-and-block access while keeping it in the room overflow/settings flow rather than the primary control bar.
- [ ] Complete live accessibility review with large OS text sizes and assistive technology on representative physical devices.

## Phase C — backend productionization

### C1. Reliability/SLO contract

`SLO-OPERATIONS.md` now defines separate measurement planes for HTTP control, signalling, translation compute, durable state, and moderation, including p50/p95/p99 latency and failure-rate measures.

- [x] Define the measurement/event contract without inventing CI-derived SLOs.
- [x] Define privacy constraints for observability dimensions and incident correlation.
- [x] Define dashboard/query and baseline procedures.
- [ ] Collect representative staging/device measurements.
- [ ] Set dated numeric SLOs and alert thresholds from those measurements.

### C2. Failure taxonomy

- [x] Define stable non-localized HTTP failure codes for operational telemetry.
- [x] Keep route class, method, result code, status, timing, and random request ID separate from localized user copy.
- [x] Exclude raw URL/query, authorization/cookies, room credentials, identity, IP, content, transcripts, and exception messages from structured operational records.
- [x] Exercise controller-level retryable vs terminal room/account failure behavior and bounded dependency timeouts in automated tests.
- [ ] Extend the same explicit failure-code taxonomy to any remaining upstream compute/TURN/TTS failure seams once live staging fault injection is available.

### C3. Release operations

- [x] Add staging deploy workflow with immutable SHA verification.
- [x] Add production deploy workflow with deliberate confirmation and exact accepted SHA verification.
- [x] Add post-deploy smoke checks for health/bootstrap/product contract and public legal surfaces.
- [x] Add a protected production rollback workflow and one-command runbook.
- [ ] Provision protected Cloudflare deployment environments/credentials and execute staging acceptance.
- [ ] Name release owner, incident owner, and moderation owner/on-call path before public launch.

## Phase D — quality engineering

### Automated

- [x] Build a real-browser host/guest/two-participant acceptance harness that drives the shipping Worker/UI contract.
- [x] Bring that harness up to current live-account `s2` authentication and affirmative Terms consent semantics.
- [ ] Execute and retain a full real-browser acceptance receipt against a target Worker with a dedicated signed-in test host.
- [ ] Add native Android emulator and iOS simulator launch/smoke coverage where platform APIs can be exercised without store accounts.
- [x] Add deterministic accessibility source/DOM contracts for labels, live regions, focus-visible behavior, touch targets, safe areas, reduced motion, and responsive layout.
- [x] Add narrow-phone/RTL/localized-content regression coverage.
- [x] Add bounded reconnect, foreground recovery, account/room controller outage, permission recovery, and local-state migration tests.
- [ ] Execute a live network-fault matrix covering offline/slow/timeout/backend-5xx/upstream-compute failure on representative staging networks.
- [ ] Add visual image-diff regression after a stable renderer/device matrix is chosen.

### Performance

- [x] Enforce deterministic prepared-web bundle budgets in CI: dashboard JS/CSS, mobile bridge, room JS/CSS, and dashboard HTML.
- [ ] Measure cold-start-to-interactive on representative devices.
- [ ] Measure create-room API latency, join-to-peer-ready latency, and first translated caption latency on staging.
- [ ] Measure session memory, sustained CPU/battery, and Wi-Fi/cellular transition recovery on representative devices.

Do not derive runtime SLO claims from CI build/test timings.

## Phase E — growth, analytics and retention

Only after the activation experience is stable and any production collection has explicit privacy/store review:

- [ ] Select PostHog, Sentry, or equivalent based on the smallest data surface needed.
- [ ] Map every transmitted event/property to privacy disclosures before enabling production collection.
- [ ] Keep session replay disabled by default for translation/call surfaces unless a separate privacy review proves safe.
- [ ] Track activation and D1/D7/D30 return behavior rather than vanity install/open counts.
- [ ] Define acquisition attribution only when actual campaigns exist.
- [ ] Add feature flags/kill switches for risky optional behavior, not for core security contracts.

## Phase F — monetization

Version 1 remains non-monetized until the product loop is proven. Do not add a placeholder paywall.

When monetization is intentionally introduced:

- [ ] define the paid value proposition first;
- [ ] model entitlements server-side/account-side before UI;
- [ ] use StoreKit / Google Play Billing through a well-supported abstraction only if it materially reduces maintenance;
- [ ] add restore-purchase, subscription state, grace-period, refund, and cancellation behavior;
- [ ] treat paywall analytics and pricing tests as a new privacy/product review.

## Store/public preparation already present in source

- [x] Public privacy, terms, support, and browser account-deletion surfaces are source controlled and covered by release checks.
- [x] App Store and Play listing text is source controlled and bounded by current metadata limits.
- [x] Play icon/feature graphic and a four-state screenshot export pipeline are source controlled.
- [x] iOS privacy manifest and native third-party notices are verified in prepared/synced artifacts.
- [x] Credential-free CI verifies Android release AAB and unsigned iOS Release artifacts.
- [x] Signed-beta lanes remain gated to Play Internal/TestFlight rather than production tracks.

## Deferred external/platform boundary

These remain real launch gates but are not evidence that source work is incomplete:

- Apple Developer Program membership and App Store Connect access;
- Google Play Console account;
- distribution certificates/profiles and release keystore;
- App Store Connect / Play service-account credentials;
- final Team ID / release-certificate association data;
- TestFlight and Play Internal signed uploads;
- store-console questionnaires, agreements, ratings, privacy/data-safety forms, and reviewer/demo access;
- physical store-distributed beta acceptance;
- dedicated support contact and named release/incident/moderation ownership;
- representative staging/device performance, scale, recovery, and cost receipts.

Repository Issue #12 continues to track the frozen `f4341026…` release/store acceptance boundary. PR #13 tracks this follow-on source/productization work and must remain draft while the audit continues.

## Framework-rewrite trigger

Reconsider React Native/Expo only if measurements demonstrate one or more of the following cannot be solved acceptably with Capacitor/native plugins:

1. sustained rendering/audio/video performance misses a defined device SLO;
2. a required platform capability cannot be safely or maintainably exposed through the current native bridge;
3. accessibility/navigation behavior cannot reach the required native quality bar;
4. web/native code divergence becomes more expensive than a migration;
5. measured conversion/retention evidence identifies a native interaction limitation, not merely visual preference.

Until then, improve the existing architecture incrementally and preserve its tested security contracts.

## Remaining pre-store source priorities

Continue in this order unless a new CI/source defect appears:

1. finish the source-gap audit against this checklist and the PR diff;
2. add useful credential-free native emulator/simulator smoke coverage rather than build-only evidence;
3. add a stable visual-regression strategy if it can run deterministically in CI;
4. extend deterministic fault-injection coverage where current upstream failure seams remain untested;
5. keep the real-browser harness ready, but do not weaken live-account authority merely to make local automation easier;
6. once external Cloudflare/test-host access exists, execute staging + real-browser/fault acceptance and record the receipts;
7. only then move into paid store/signed-beta/device acceptance.

No source-level store approval, signed-store acceptance, live staging acceptance, or physical-device acceptance should be claimed until the corresponding gate is actually executed.

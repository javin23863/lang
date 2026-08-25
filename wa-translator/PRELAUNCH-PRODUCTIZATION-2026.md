# Lingua Relay — 2026 pre-launch productization plan

Status: active follow-on work after exact-head acceptance of `f43410267bc28cbc7791189f9f2da3055e195bef`.

This plan intentionally excludes paid Apple Developer / Google Play Console credentials, signing identities, store upload, and physical-store beta acceptance until those accounts exist. It covers the work that should be completed before that boundary.

## Product architecture decision

Keep the current **Capacitor + Cloudflare Workers/Durable Objects + web UI** architecture unless measured product requirements prove that the web/native bridge is the limiting factor.

Do not rewrite to Expo/React Native merely because it has a larger starter ecosystem. The product already has a tested security/session model, two-person room authority, native bridge, deep links, release verifiers, localization, and exact-head CI. A framework rewrite would reset much of that evidence without improving the product by itself.

Use current 2026 starters as a benchmark for practices instead:

- Infinite Red Ignite: long-lived Expo/React Native boilerplate with TypeScript, navigation, localization, persistence, generators and testing. <https://github.com/infinitered/ignite>
- Capstart: web-first React 19 + Vite + TypeScript + Capacitor 8 starter/tooling, explicitly including migration of existing web projects. <https://github.com/AdrienADV/capstart>
- Expo App Template: feature-based consumer app example with capability-gated integrations, typed analytics, onboarding/auth and production configuration checks. <https://github.com/Simonstorms/expo-app-template>
- Expo Forge: feature/design-system structure with optional analytics, observability, payments and validated environment configuration. <https://github.com/abed42/expo-forge>
- React Native Boilerplate: useful comparison point for the common Sentry/PostHog/RevenueCat/notifications/i18n productization bundle. <https://github.com/reactnative-boilerplate/react-native-boilerplate>

Community discussions in 2026 reinforce two useful themes: production monitoring commonly converges on Sentry/PostHog-style tooling, while existing web applications can be reasonable Capacitor candidates when the result behaves like a real mobile product rather than a thin website wrapper.

The lesson for Lingua Relay is therefore **borrow the operating model, not the framework**.

## North-star activation event

A new user is not activated when the app is installed, opened, or when a room is merely created.

For v1, activation is:

> A host creates a private two-person room, successfully gets the invite to the other participant, the other participant joins, and the pair completes a useful translated interaction.

The product funnel should let us determine where users fail before that point without collecting room bearer URLs, names, email addresses, message text, captions, transcripts, or translation content.

### Initial event vocabulary

The app now has a vendor-neutral local `lingua:product-event` seam. Initial safe events are:

- `app.open`
- `auth.state`
- `room.create.intent`
- `room.create.result`
- `invite.share.intent`
- `room.open.intent`
- `room.close.result`
- `locale.change`

The local seam performs no network transmission or persistence. A future analytics adapter is a separate privacy/store-declaration decision.

Before adding a third-party analytics SDK, extend the vocabulary around the actual activation boundary using only coarse non-content fields, for example mode, result class, platform and latency bucket. Never send room paths/tokens or conversation content.

## Phase A — foundation and operability

### A1. Observability

- [x] Upload Worker source maps.
- [x] Enable Workers Logs.
- [x] Keep automatic invocation URL logging disabled while room URLs are capability-bearing.
- [x] Add a regression guard for the observability/privacy configuration.
- [ ] Define first-party structured operational event names for backend failures and dependency states.
- [ ] Define request/error correlation IDs that do not derive from account identity or room credentials.
- [ ] Establish dashboards/queries for request error rate, Durable Object errors, upstream compute failures and latency.
- [ ] Define alert thresholds and an incident/rollback runbook.

### A2. Environments

- [ ] Separate local, staging and production configuration as explicit deployment targets.
- [ ] Give staging a distinct Worker name/origin and non-production OAuth/provider credentials when available.
- [ ] Add configuration validation that fails closed when a production deployment contains placeholder/staging values.
- [ ] Document promotion and rollback from an immutable commit SHA.

### A3. Product telemetry contract

- [x] Add vendor-neutral allowlisted event schema.
- [x] Reject identity/content/capability-shaped fields.
- [x] Keep the base seam network- and storage-free.
- [ ] Wire safe user-intent events into the existing dashboard.
- [ ] Emit operation results at their real API/runtime boundaries during feature decomposition.
- [ ] Add activation events for guest join and first successful translation without participant identifiers.
- [ ] Choose analytics vendor only after privacy review; keep the application call sites vendor-independent.

## Phase B — frontend product architecture

The current UI is functional but much of the shipping web application remains hand-written static HTML/CSS/JS. Do not replace it all at once. Migrate behind the existing security and behavior tests.

### B1. Shared design system

- [ ] Centralize semantic design tokens: surface, text, accent, status, spacing, radius, elevation, typography and motion.
- [ ] Keep light/dark/system appearance and reduced-motion support.
- [ ] Create reusable button, field, card, status, sheet/dialog and empty/error state patterns.
- [ ] Preserve safe areas, RTL, 320–430 px phone widths, tablets, landscape and dynamic text behavior.
- [ ] Add visual-state fixtures/screenshots for critical screens.

### B2. First-run onboarding / activation

The first-run experience must explain the product before asking users to reason about implementation concepts.

- [ ] Explain the core promise in one screen: private two-person translation; host creates, guest joins by invite.
- [ ] Explain voice/video/chat modes with outcome-oriented copy.
- [ ] Prepare microphone/camera permission context immediately before the feature needs it, not at cold launch.
- [ ] Make sign-in purpose explicit: hosts need an account; invited guests do not.
- [ ] Route returning users around completed onboarding.
- [ ] Persist onboarding completion locally only; do not turn it into identity data.
- [ ] Measure progression with the local event seam before adding a vendor transport.

### B3. Dashboard decomposition

Move behavior feature-by-feature instead of a big-bang rewrite:

1. API/deadline client.
2. Account/auth presenter.
3. Room creation/control model.
4. Share/invite presenter.
5. Usage/settings presenter.
6. Boot/lifecycle coordinator.

Keep the current integration tests as behavioral contracts. Replace literal implementation assertions only when equivalent or stronger behavior-level tests exist.

### B4. Room experience redesign

- [ ] Make connection state, participant state and translation state visually distinct.
- [ ] Define complete loading/empty/reconnecting/degraded/offline/expired/blocked states.
- [ ] Improve permission-denied recovery for camera/microphone.
- [ ] Audit one-handed control placement and touch targets.
- [ ] Verify captions against long strings, RTL languages and large accessibility text.
- [ ] Make network interruption/reconnect behavior understandable rather than exposing transport details.
- [ ] Preserve report-and-block visibility without making moderation controls visually dominant.

## Phase C — backend productionization

### C1. Reliability/SLO contract

Track separately for HTTP control plane, WebSocket/signalling and translation compute:

- availability / success rate;
- p50/p95/p99 request latency;
- room-create failures;
- signalling reconnect rate;
- upstream compute connect/timeout/error rate;
- TURN credential failures;
- translation first-result and steady-state latency;
- Durable Object alarm/storage errors;
- report/moderation queue failures.

Set initial SLOs only after representative measurements exist. Do not manufacture thresholds from local CI timings.

### C2. Failure taxonomy

- [ ] Define stable internal error codes separate from localized user copy.
- [ ] Classify retryable vs terminal failures.
- [ ] Ensure logs contain route class, operation, result code and timing—not bearer URLs or content.
- [ ] Add correlation IDs to support diagnostics without using account IDs as trace IDs.
- [ ] Exercise dependency timeout, partial outage and recovery behavior in integration tests.

### C3. Release operations

- [ ] Add staging deploy workflow with immutable SHA receipt.
- [ ] Add production deploy workflow requiring deliberate approval and exact accepted SHA.
- [ ] Add post-deploy smoke checks for health, bootstrap, legal/support surfaces and associations.
- [ ] Document one-command rollback to the previous known-good Worker version.
- [ ] Define release owner, incident owner and moderation owner before public launch.

## Phase D — quality engineering

### Automated

- [ ] Browser E2E for host create/share/open/close and guest join.
- [ ] Native emulator/simulator smoke suite where platform APIs can be exercised without store accounts.
- [ ] Accessibility checks for labels, focus order, keyboard navigation, reduced motion and contrast.
- [ ] Responsive/visual regression fixtures for small phone, standard phone, large phone and tablet widths.
- [ ] Network fault matrix: offline, slow, timeout, reconnect, backend 5xx and upstream compute failure.
- [ ] Upgrade/migration tests for previously installed local/session state.

### Performance

Define budgets before visual polish grows the app:

- initial dashboard JS/CSS transfer size;
- cold-start to interactive time;
- create-room API latency;
- join-to-peer-ready latency;
- first translated caption latency;
- memory during voice/video sessions;
- sustained CPU/battery behavior;
- reconnect time after Wi-Fi/cellular transition.

Measure on representative hardware later; CI budgets should guard bundle growth and deterministic code paths now.

## Phase E — growth, analytics and retention

Only after the activation experience is stable:

- [ ] Select PostHog, Sentry, or equivalent based on the smallest data surface needed.
- [ ] Map every transmitted event/property to privacy disclosures before enabling production collection.
- [ ] Keep session replay disabled by default for translation/call surfaces unless a separate privacy review proves safe.
- [ ] Track activation and D1/D7/D30 return behavior rather than vanity install/open counts.
- [ ] Define acquisition attribution only when actual campaigns exist.
- [ ] Add feature flags/kill switches for risky optional behavior, not for core security contracts.

## Phase F — monetization

Version 1 remains non-monetized until the product loop is proven. When monetization is intentionally introduced:

- [ ] define the paid value proposition first;
- [ ] model entitlements server-side/account-side before UI;
- [ ] use StoreKit / Google Play Billing through a well-supported abstraction such as RevenueCat only if it materially reduces maintenance;
- [ ] add restore-purchase, subscription state, grace-period and refund/cancellation behavior;
- [ ] treat paywall analytics and pricing tests as a new privacy/product review.

Do not add a disabled or placeholder paywall to the current product.

## Deferred paid-platform boundary

These are intentionally not blockers for the present phase:

- Apple Developer Program membership;
- Google Play Console account;
- distribution certificates/profiles and release keystore;
- App Store Connect / Play service-account credentials;
- final Team ID / signing-certificate association data;
- TestFlight and Play Internal uploads;
- store-console questionnaires and agreements;
- physical store-distributed beta acceptance.

Repository Issue #12 tracks those later gates against the previously accepted frozen release checkpoint.

## Framework-rewrite trigger

Reconsider React Native/Expo only if measurements demonstrate one or more of the following cannot be solved acceptably with Capacitor/native plugins:

1. sustained rendering/audio/video performance misses a defined device SLO;
2. a required platform capability cannot be safely or maintainably exposed through the current native bridge;
3. accessibility/navigation behavior cannot reach the required native quality bar;
4. web/native code divergence becomes more expensive than a migration;
5. measured conversion/retention evidence identifies a native interaction limitation, not merely visual preference.

Until then, improve the existing architecture incrementally and preserve its tested security contracts.

## Pre-store-account exit criteria

Before spending money on the store accounts, Lingua Relay should have:

- a coherent first-run activation flow;
- production-quality dashboard and room state design;
- privacy-safe product-event definitions;
- backend observability and a failure/SLO model;
- explicit staging/production deployment procedure;
- browser/native smoke and network-fault coverage;
- accessibility and localization QA closure;
- bundle/performance budgets;
- complete public support/privacy/terms/deletion surfaces;
- store metadata/screenshots substantially ready;
- no known source-level release blocker.

At that point the paid accounts become execution dependencies rather than an excuse to discover product or architecture problems late.

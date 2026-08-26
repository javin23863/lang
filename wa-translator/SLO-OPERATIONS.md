# Lingua Relay — reliability and SLO operating contract

This document defines what is measured before public launch. It deliberately does **not** invent numeric SLOs from CI or local development timings. Initial thresholds are set only after representative staging and device traffic exists.

## Service planes

Measure these separately. A single aggregate availability number hides the failure mode that matters to users.

### HTTP control plane

Operations:

- mobile bootstrap;
- account snapshot/auth handoff;
- room create/status/close;
- capability catalog;
- TURN credential issuance;
- report submission;
- account deletion/logout.

Primary measures:

- request count by route class and operation;
- success/client-error/rate-limit/server-error counts;
- p50/p95/p99 duration by operation;
- room-create result rate;
- upstream timeout/unavailable rate;
- request-correlation coverage on failures.

### Signalling plane

Primary measures:

- room joins;
- two-participant activation completion;
- WebSocket reconnects per joined room session;
- room-full rejects;
- terminal room expiry/closure;
- abnormal socket close classes;
- time from join to peer-ready when representative client measurements exist.

No metric key may contain a room bearer, room path, participant identifier, account identifier, IP address, message text, caption text, or transcript.

### Translation plane

Primary measures:

- caption compute request success/timeout/capacity/unavailable classes;
- translation first-result latency;
- steady-state translation latency;
- TTS request success/timeout/rate-limit/playback failure classes;
- TURN issuance and relay-availability failures.

Translation content is never an observability dimension.

### Durable state and moderation

Primary measures:

- Room Durable Object exceptions/storage errors;
- UserDirectory exceptions/storage errors;
- abuse quota failures;
- report inbox durable-write failures;
- accepted-report room-invalidation failures;
- moderation queue age/count when production moderation begins.

## Structured event contract

The outer Worker emits privacy-safe JSON records. Required common fields are:

- `event` — stable event name;
- `request_id` — random correlation ID generated for that request;
- `route_class` — coarse fixed route family;
- `operation` when the operation is safely enumerable;
- `method` — normalized allowlisted HTTP method;
- `status` for HTTP results;
- `result` / `result_code` — stable non-localized outcome class;
- `duration_ms` — bounded integer duration.

Forbidden fields include raw URL, query string, authorization header, cookie, room token/path, account/user identity, IP address, names, email, message/caption/transcript/content, and exception messages.

## Initial dashboards / saved queries

Create these views in Cloudflare observability once staging is deployed and emitting representative traffic:

1. **Control-plane health** — request count, error ratio and p50/p95/p99 duration grouped by `route_class`, `operation`, `result_code`.
2. **Room activation** — room-create success, join success, two-person join completion and terminal close/expiry counts. No room-level drill-down by bearer.
3. **Translation dependency** — compute timeout/unavailable/capacity classes and TURN/TTS failure classes over time.
4. **Durable state** — Worker/DO exception counts grouped only by class and operation.
5. **Moderation** — report durable-write success/failure and pending room-invalidation count.

Use `request_id` only for short-lived incident correlation. It is random per request and is not a user/session identifier.

## Baseline and threshold procedure

Before setting SLO numbers:

1. deploy staging from an immutable SHA;
2. run the smoke and fault suites;
3. collect representative device/network measurements across Wi-Fi and cellular;
4. record p50/p95/p99 by service plane rather than combining them;
5. exclude deliberate client 4xx from service availability while retaining abuse/rate-limit trends;
6. choose thresholds from observed distributions plus product tolerance;
7. record the chosen values and measurement window in this file with a dated evidence receipt.

Until step 7 is complete, a numeric "99.9%" or latency target is not a release claim.

## Alert classes before numeric baselines exist

The following are immediately actionable even without a calibrated percentage threshold:

- production smoke check fails after deploy;
- mobile bootstrap stops returning protocol 2 / two-person contract;
- sustained server-error or exception records appear for room creation;
- all translation compute requests return timeout/unavailable;
- TURN issuance stops succeeding;
- report durable writes fail;
- release Worker cannot serve privacy/terms/support/deletion surfaces;
- a deployment receipt SHA differs from the deliberately approved source SHA.

Once a measured baseline exists, add rate/latency alerts that require a minimum request count and a sustained window so a single request does not page an operator.

## Incident sequence

1. Confirm the current production version and immutable source SHA.
2. Check control-plane, translation, DO and moderation views separately.
3. Use a surfaced `X-Lingua-Request-ID` only to correlate a reported HTTP failure with the corresponding structured record.
4. If the fault was introduced by the current Worker version and rollback is compatible with the DO/binding schema, use the documented production rollback lane.
5. If rollback is unsafe because a binding/migration changed, stop promotion and repair forward from the last known-good source contract.
6. Run production smoke checks after recovery and record the version/SHA receipt.

## Ownership required before public launch

The public launch checklist must name a release owner, incident owner, and moderation owner/on-call path. Those are operational account decisions and cannot be inferred from source code.

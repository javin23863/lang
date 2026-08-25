# Lingua Relay — Version 1.0 release contract

Status: active development contract, 2026-08-25.

This file is the authoritative product boundary for the first Android, iOS, and
public web release. If a dated handoff, research note, historical spec, receipt,
or implementation comment conflicts with this file, **this file wins**. The
release checklist in `wa-translator/mobile/LAUNCH-CHECKLIST.md` records whether
this contract is implemented and what still requires credentials or physical
devices.

## Product

Lingua Relay is a **two-person, foreground conversation product**. Every live
room contains exactly one local participant and one remote participant. Version
1.0 does not support group rooms, four-person rooms, multiparty grids, or
multi-listener media behavior.

The same private room can be presented as video, voice, or text chat. Those
modes change local presentation only; they do not create different security or
room-ownership models.

A host must sign in before creating a room. An invited participant opens the
private room link and does **not** need an account. Version 1.0 is non-monetized:
there is no credit balance, purchase surface, subscription, StoreKit product, or
Google Play Billing product.

## Room and link lifecycle

- A participant invitation is an HTTPS bearer URL containing only the signed
  room token and optional call mode.
- New clients do not put a participant name, account identifier, phone number,
  or other personal label into the room URL.
- Rooms and host controls expire no later than 24 hours after creation.
- A third joined participant is rejected. Pending/unjoined sockets are not
  counted as joined participants.
- Host control is a separate bearer from the participant link and is stored only
  on the host device. Successful sign-out or account deletion removes the local
  saved host control so another account on a shared device cannot inherit it.
- Account deletion does not retroactively revoke an already-issued participant
  room link. That room continues independently until close/expiry, but later
  metering is not stored to the deleted account.

## Accounts and authentication

Hosts sign in with configured OAuth providers. Browser sessions use an HttpOnly,
Secure cookie. Native OAuth runs in the system browser and returns through the
registered Lingua Relay app scheme using a short-lived, app-bound, one-time
handoff. The installed app keeps the raw proof and native session in platform
secure storage.

New external browser/native sessions use the `s2` format: user ID, original
expiry, a random 128-bit issuance nonce, and a domain-separated HMAC. Two logins
for the same account at the same instant therefore remain different credentials
and can be revoked independently. The shipping edge temporarily accepts valid
legacy `s1` sessions for migration, but newly exposed browser cookies and native
handoff sessions must be `s2`. A verified `s2` may be translated to an internal
legacy representation only while calling the pre-v2 Worker; revocation always
hashes the exact external credential rather than that internal representation.

A valid session is not sufficient by itself: protected account mutations and
room creation also require that the corresponding `UserDirectory` account still
exists and that the exact session has not been revoked by logout. Successful
logout durably revokes only that session; another valid device session for the
same account remains active. Account deletion removes the account and blocks all
old sessions through the account-existence check.

Provider subject + provider namespace derives account identity. Presentation
metadata such as display name/email cannot change that identity. Existing
provider/user ID is immutable, unsafe control/bidi formatting is removed from
presentation strings, and later provider claim omissions do not erase an
established account profile. Apple's one-time `user` form data contributes only
a bounded display name after normal OAuth validation succeeds.

## Media and translation

Camera and natural peer audio use WebRTC. Cloudflare owns room state,
signalling, accounts, abuse controls, TURN credential issuance, and public
HTTP/WebSocket contracts. Modal owns authenticated ASR, machine translation,
and optional translated-voice compute.

Live captions transcribe each speaker once and translate for the other person's
base language. Optional translated voice is listener-selected and starts off;
captions remain the safe default. Version 1.0 makes no claim of voice cloning,
biometric inference, call recording, transcript history, background calling, or
incoming VoIP service.

The voice presentation is a foreground room, not a telephone ringing service.
Either participant join order must converge on Connected once both people are
present.

## Native application

The store application uses Capacitor 8 and bundles reviewed web assets locally.
It is not a remote-site WebView shortcut. Android package and iOS bundle ID are
`com.javin23863.linguarelay`.

Public room invitations use verified Android App Links / iOS Universal Links.
Authentication return uses the app-only custom scheme. Native compatibility
bootstrap must match the canonical public origin, account/session mode,
foreground lifecycle, protocol/build requirements, and `max_room_participants:
2` before the installed app proceeds. Session-v2 issuance is a breaking native
compatibility change, so Version 1.0's current installed-client bootstrap
protocol is `2`; pre-v2 clients must fail closed rather than enter OAuth with an
unsupported session response format.

The final branded production origin is an operator/configuration gate and must
not be invented in source. Production Worker configuration, native association
sync, and signed-store preflight must all resolve from the same canonical
`PUBLIC_ORIGIN`.

## Privacy, safety, and retention

Lingua Relay intentionally stores no conversation history: no audio, video,
caption transcript, chat body, translated-voice audio, screenshot, or free-text
abuse report is retained as a conversation record.

Account-held data consists of provider/account profile metadata, aggregate usage
totals, and bounded recent usage rows. Recent usage rows are retained for up to
90 days, capped at the most recent 200. Retry-deduplication markers are retained
for 48 hours. A logout revocation record contains only a one-way SHA-256 digest
of that session token plus its original expiry and lasts no longer than the
session itself. Account deletion removes account-held data immediately.

Abuse reports are category-only and exclude names, room links, conversation
content, captions, audio, video, screenshots, and free text. Report records have
a 30-day ceiling. Internal room routing metadata used only to close a reported
room is removed when that room expires, no later than 24 hours after creation.

Room entry requires affirmative acceptance of the current Terms version. The
checkbox is not preselected; only prior acceptance of the exact current version
may restore it.

## Release gates

Development is not release acceptance. Before public store submission, the exact
final development commit must complete the credential-free test/build matrix,
signed Android internal/TestFlight workflows, live provider/link/deletion
preflight, and representative physical Android/iPhone lifecycle testing.

Credential/operator gates still include the final public origin, OAuth
credentials, Apple Team ID and signing identity, Play signing fingerprint,
store-console records and review inputs, a monitored moderation owner, and the
final store privacy/content/export/rating forms.

No CI run, old deployment receipt, browser-only test, or unsigned compilation is
a substitute for the final exact-head signed and physical-device acceptance.

## Source-of-truth hierarchy

1. `RELEASE-1.0.md` — immutable Version 1.0 product boundary.
2. `wa-translator/mobile/LAUNCH-CHECKLIST.md` — implementation/gate status.
3. `wa-translator/mobile/STORE-DECLARATIONS.md` — store/privacy declaration
   answers derived from the active product.
4. `wa-translator/mobile/REVIEW-INPUTS.md` — owner-supplied store-review inputs.
5. `CLOUD-ARCHITECTURE.md`, current runtime code, and tests — implementation
   architecture under the product boundary above.
6. Dated `MOBILE-STORE-*`, `MULTILINGUAL-PRODUCT-HANDOFF.md`, and older
   `SPEC-v*` documents — historical research/receipts only unless explicitly
   updated to reference this release contract.

## Known structural debt

`wa-translator/cloudflare/src/worker.ts` still contains the pre-Version-1.0
four-person implementation. Shipping Wrangler entrypoints go through
`session-issuance-entry.ts` → `account-guard-entry.ts` → `launch-entry.ts` →
`mobile-entry.ts` and export the strict two-person `Room` wrapper; installed
clients independently fail closed on a different participant/protocol contract.
Do not deploy the base `worker.ts` `Room` directly. Moving the invariants into
the base class and deleting the wrapper layers is post-P0 structural cleanup
that should be done only with the complete room/auth regression suite available
to run.

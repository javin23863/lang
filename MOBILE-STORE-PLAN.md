# Mobile store launch plan — historical August 14 plan

> **Superseded for Version 1.0.** This document records the August 14, 2026
> mobile-packaging plan and is retained for engineering history. It is **not**
> the current product contract. The authoritative release boundary is
> [`RELEASE-1.0.md`](RELEASE-1.0.md), and implementation/release-gate status is
> tracked in [`wa-translator/mobile/LAUNCH-CHECKLIST.md`](wa-translator/mobile/LAUNCH-CHECKLIST.md).
>
> In particular, the original plan's **accountless** and historical
> **four-person/four-stream** assumptions are superseded. Version 1.0 is exactly
> two joined participants; hosts sign in to create rooms; invited participants
> do not need accounts; and Version 1.0 is non-monetized.

Original planning date: 2026-08-14.

## What remains valid from this plan

The architecture choice remains valid: use Capacitor 8 to package the existing
web application for Android and iOS rather than rewrite the UI stack. Cloudflare
remains the room/signalling/account control plane and Modal remains remote
speech/translation/optional-voice compute. Public room links use Android App
Links / iOS Universal Links, and native secrets/host-control state use platform
secure storage.

The following planning principles also remain valid:

- Native projects boot bundled files rather than a remote website shell.
- Microphone and camera are foreground-only and requested independently.
- Host-control bearer state belongs in Keychain/Android Keystore-backed secure
  storage; ordinary language/voice preferences do not need secret storage.
- Mobile APIs use an explicit compatibility/version seam rather than weakening
  signed-room validation.
- Privacy, Terms, Support, account deletion, category-only abuse reporting, and
  local room blocking are release requirements.
- Android/iOS unsigned builds and credential-free regressions are development
  gates; signed store uploads remain credential/owner gates.
- Store assets and metadata are source-controlled and must match actual product
  behavior.
- Physical Android-to-iPhone acceptance is a required launch gate and cannot be
  replaced by browser-only automation.

## Superseded product assumptions

The August 14 plan described a free **accountless** application. That is no
longer the shipping design. Current behavior is:

- a host authenticates through configured OAuth before room creation;
- a guest joins the private invitation without an account;
- browser/native sessions have explicit revocation and account-existence checks;
- account deletion is available both in-app and through a dedicated public web
  deletion resource;
- the room contract is exactly two joined participants;
- no purchase/credit/subscription surface ships in Version 1.0.

The original plan also treated a four-stream beta compute number as a client
compatibility promise. Current installed-client bootstrap deliberately does not
advertise that historical compute ceiling. Compute admission/scale is an
operator deployment property; room capacity remains exactly two regardless of
GPU scaling.

## Current implementation order

The active development sequence is now:

1. Finish source-side correctness/security/privacy/store behavior against the
   Version 1.0 contract.
2. Keep browser/native generation paths and public/native API contracts aligned.
3. Maintain one authoritative launch checklist and store-declaration source.
4. Stop source expansion when remaining items require credentials, store-console
   ownership, final exact-head verification, or physical devices.
5. Run the complete credential-free matrix on the exact final development
   commit.
6. Run signed Play Internal/TestFlight workflows on that same commit.
7. Complete representative physical Android/iPhone acceptance and final store
   forms before public submission.

## Operator-only actions after development

The operator must still verify Apple Developer and Google Play accounts, accept
current legal agreements, own signing identities, configure the final public
origin and OAuth callbacks, install protected repository/store credentials,
configure the real Play signing fingerprint and Apple Team ID, provide public
support/moderation ownership, complete store review/data/privacy/rating/export
forms, run signed beta uploads, and perform physical-device acceptance.

Store approval cannot be automated or guaranteed.

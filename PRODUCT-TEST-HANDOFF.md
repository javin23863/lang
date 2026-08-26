# Lingua Relay product test handoff

Status date: **2026-08-26 +07**.

This is the current product-testing checkpoint for branch
`product/app-shell-tabs-20260826-v2`. It supplements `RELEASE-1.0.md` and
`wa-translator/mobile/LAUNCH-CHECKLIST.md`; it does not replace release gates.
Historical August 14 receipts remain historical only.

Implementation checkpoint before this notes-only commit:
`73292173477dce81b46b889c6dc22d164b2df923`.

At that checkpoint the branch is **730 commits ahead of `main`** and zero behind.
There is no pull request for this branch and no current-head GitHub check run.
The normal `mobile-build.yml` push trigger covers only `main` and `prelaunch/**`,
so this branch must not be described as exact-head CI accepted.

## Product state

The repository now contains an integrated two-person development product rather
than isolated UI mockups. The existing Cloudflare room/account/signalling plane,
Modal speech/translation plane, browser/PWA UI, and Capacitor Android/iOS shell
are wired through the same Version 1.0 room contract.

Current product-facing source includes:

- authenticated host creation and account controls, while invitees still join
  without an account;
- Home, Activity, Languages, and Profile application tabs;
- first-run/preferences surfaces and a preferred Quick Start driven by the saved
  Video / Voice / Chat default and saved conversation language pair;
- conversation setup for Video, Voice, and Chat, including functional language
  swapping and remembered language choices;
- room-ready state with mode-aware Enter/Open controls;
- a dedicated **Invite person** surface backed by the real room bearer, with QR,
  system Share, Copy Link, browser WhatsApp/LINE, current language pair, current
  mode, and live Waiting/Connected presentation;
- guest pre-join checks that are local-only: camera preview plus microphone level
  for Video, microphone level for Voice, and an explicit no-media-required state
  for Chat;
- the shared two-person room with video, natural audio, translated captions,
  translated voice where supported, and translated text chat;
- post-conversation actions for starting another conversation in the same mode or
  returning Home; repeating a conversation returns Home and opens the matching
  setup flow;
- native web generation that carries the current dashboard product surfaces and
  the guest pre-join/post-conversation room overlays into Android/iOS builds.

The invitation sheet deliberately reuses the existing room URL and share
handlers rather than creating another invite contract. Its QR is rendered only
for the active invitation and removed when the sheet closes. The old duplicate
raw-link/share presentation is hidden from the host room card while the backing
controls remain available to the established sharing implementation.

## What can be tested now

### 1. Browser product, locally

Use Node 24 or newer. Start the development Worker from
`wa-translator/cloudflare`:

```text
npm ci
npx wrangler dev -c wrangler.dev.jsonc --port 8788 --local
```

The repository's browser driver documents the same origin. Automated host
journeys require a dedicated signed-in test host and its current `s2` browser
session value in `LINGUA_SESSION`:

```text
set LINGUA_SESSION=<dedicated-test-host-s2-session>
node wa-translator/tools/browser/run.mjs
```

On shells other than Windows, export the environment variable using that shell's
normal syntax. The browser runner exercises host dashboard flows, narrow/RTL
room journeys, and a two-participant room. It records screenshot provenance only
after all driven journeys pass.

For manual product testing, use the same local Worker and walk this sequence:

1. Sign in as the host and verify Home / Activity / Languages / Profile.
2. Set the preferred mode and language pair, then verify Quick Start and the
   language-swap controls.
3. Create Video, Voice, and Chat rooms separately.
4. Open **Invite person** and verify mode/language summary, QR, Share, Copy Link,
   WhatsApp/LINE on web, and Waiting state.
5. Open the participant link in a second browser/device without signing in.
6. Verify the guest pre-join screen: Video camera + microphone, Voice microphone,
   Chat no-media-required.
7. Join and verify the host invitation surface moves to Connected, then exercise
   the room's media/chat/translation controls.
8. End/leave and verify Start another conversation and Back to Home; repeating
   should reopen the matching setup mode from Home.

### 2. Native source and synchronized projects

From `wa-translator/mobile`:

```text
npm ci
npm run check
npm run assets
npm run sync
```

`npm run sync` rebuilds the bundled web application, synchronizes Capacitor, and
updates platform-origin/notice contracts. The native app is a bundled Capacitor
application, not a remote-site wrapper. Android and iOS platform projects are in
`wa-translator/mobile/android` and `wa-translator/mobile/ios`.

The repository also contains emulator/simulator smoke scripts and unsigned
release-build automation. Those are useful development paths, but they are not a
substitute for the final signed and physical-device matrix.

## What is not yet proven

This branch is **not** release accepted and is **not** currently proven by an
exact-head automated matrix. At the implementation checkpoint GitHub reports no
status checks/check-runs for the branch head. No new public Worker deployment,
Play Internal build, TestFlight build, or physical Android-to-iPhone acceptance
was performed as part of this product UI pass.

Therefore there is no current hosted URL that should be claimed as the exact
`product/app-shell-tabs-20260826-v2` product. The older public Worker and August
receipts are useful backend/history evidence only; they are not proof that this
branch's current dashboard, guest pre-join, invitation, or post-conversation UI
is what a public visitor will receive.

Major gates still open before a consumer beta/release claim include:

- run the complete credential-free product/Worker/mobile Android/iOS matrix on
  an exact frozen product head, preferably through the repository's existing
  `prelaunch/**` or deliberate release workflow path;
- deploy that exact source to an isolated test/staging origin or otherwise run
  the local browser matrix against it;
- perform representative real two-device Android/iPhone testing of auth, room
  links, camera/microphone permissions, Video/Voice/Chat, translation, QR/share,
  foreground/background recovery, reconnect/TURN, network changes, and expiry;
- satisfy live Apple-provider, Android signing-certificate association, Apple
  Team-ID association, public product-support contact, moderation owner, store
  review inputs, and store privacy/rating/export forms;
- only after the product head is frozen, run signed Play Internal and TestFlight
  workflows on that same source and complete physical-device acceptance.

## Current assessment

**Working integrated development product:** yes.

**Ready for a local browser/product walkthrough:** yes, with the development
Worker and a valid dedicated test-host session/provider setup.

**Ready to build/synchronize into the native Android/iOS projects:** yes at the
source/tooling level.

**Current exact-head CI accepted:** no.

**Current branch deployed to a user-test URL:** no evidence in this checkpoint.

**Signed beta / TestFlight / Play Internal accepted:** no.

**Public-store release ready:** no.

The next meaningful milestone is not another detached hardening pass. It is to
freeze the current product surface, run the exact-head credential-free matrix,
then exercise this specific UX end to end on an isolated Worker and two real
mobile devices before any store-beta claim.

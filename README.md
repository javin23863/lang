# lang — live multilingual video room

## Mobile app

The Android/iOS store shell lives in `wa-translator/mobile`. It reuses the same
room interface and permanent cloud backend; it does not depend on Codex, a
Windows server, or a remote-webview shortcut. Start with
[`MOBILE-STORE-HANDOFF.md`](MOBILE-STORE-HANDOFF.md) for builds, store account
setup, and the physical-device release gates.

## Release status — 2026-08-14

This is a working closed-beta build, merged to `main` by PR #5 at
`4340d6d4d308081f21ba8d82526db5a278378748`; the handoff receipt was merged by
PR #6 at `8eb138eb0b98537abaacd02e11d384648d168715`. The public service is
live at [`spoken-translation-room.spoken-translation-cloudflare.workers.dev`](https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/).
The current Worker version is `f2c94502-82f3-4281-809f-3aed424bb25b`, built
from runtime source `b7b0fffdd41816b45cf0e1ee53893b6802d75853`.

Verified receipts:

- Public `/health`, `/api/v1/mobile/bootstrap`, `/privacy`, `/terms`, and
  `/support` returned 200. The browser acceptance run passed the 106-profile
  picker (including Khmer `km-KH`), Arabic RTL, 360px layout, WebRTC camera and
  microphone, permission recovery, device voice, translated WAV playback,
  report/share, dashboard room create/close, and participant Leave.
- `wa-translator/mobile`: `npm run check` passed 14/14; post-merge GitHub
  Actions run `31769087455` passed Android, iOS, and product regression.
- Windows checks passed 46/46 with the project dependency environment. The
  Android AAB is 3,095,207 bytes,
  `C9D1196739A69B6CCC7738DFE292051EF568FCA83CE3C3A4F498E4C1FCA3296E`;
  the unsigned iOS executable is 441,048 bytes,
  `232F76EFE5B106FF977493924F5B5C6FA68E0BB4FD0400E90B7487B046C4B120`.
- The Windows desktop shortcut is
  `C:\Users\MSI\Desktop\Live Translator.lnk`. It launches Edge app mode
  directly at the public origin and does not depend on Codex, a tunnel, or a
  localhost server. Development ports 8791 and 9914 are clear.
- Store screenshots were regenerated from the public surface. They contain no
  localhost URLs, development explanation text, unavailable-capability
  warnings, or fabricated captions.

### Still required before store publication

The code and unsigned build artifacts are complete; paying store fees alone is
not the final release step. The following are intentionally not claimed as
done:

1. **Google Play:** verify the developer account, create package
   `com.javin23863.linguarelay`, enable Play App Signing, create the release
   service account, install the protected CI secrets, and upload to Internal
   Testing before production review.
2. **Apple:** verify Apple Developer/App Store Connect, register the same bundle
   ID and Associated Domains, install the Team ID/API key/distribution
   certificate/profile secrets, and upload to TestFlight.
3. **Deep links:** install the exact Play App Signing SHA-256 and Apple Team ID
   bindings in the Worker. Until then, Android `assetlinks.json` and the iOS
   Universal Links file deliberately return 503 rather than making a false
   green claim.
4. **Physical release acceptance:** test an Android-to-iPhone call with real
   camera, microphone, captions, natural peer audio, and the selected voice
   profiles; then complete each store's review forms and staged rollout.
5. **Known beta ceilings:** links expire after 24 hours; capacity is one
   scale-to-zero L4 with a global four-stream beta limit; TURN relay and a
   human-audible Codex-browser acceptance are not claimed in this receipt.

The complete command list, secret names, artifact receipts, and launch runbook
are in [`MOBILE-STORE-HANDOFF.md`](MOBILE-STORE-HANDOFF.md). Do not put signing
keys, store JSON keys, report-admin values, or room bearer links in this README.

One private link, up to four browsers. Camera and natural voice go directly
between peers while a single transcription fans out to the unique base
languages of current listeners. Captions-only is the default; a listener can
independently choose an exact declared synthetic Voice Profile where one is
enabled.

The shared catalog currently declares **100 M2M100 text Languages**, **84 free
Whisper→M2M100 microphone-language candidates**, and **106 selectable BCP-47
Locale profiles** across those candidates. Six Languages (Arabic, German,
English, Spanish, French, Japanese) remain the separately marked, exercised
`Tested` tier; the rest are visibly `Preview`, not quality-certified. Locale
variants such as `es-MX` map to base `es` and do not claim a distinct ASR/MT
model or dialect quality. Voice output combines thirteen pinned included
profiles for English, Spanish, French, Hindi, Italian, and Brazilian Portuguese
with exact-language voices installed on each user's browser/device. No
neighboring-language voice fallback is allowed.

There are two adapters. The Windows adapter below is the local development path.
The production beta uses a permanent Cloudflare `workers.dev` room plus a
scale-to-zero Modal GPU and short-lived Cloudflare TURN credentials. It still
has no accounts or database. See [`CLOUD-ARCHITECTURE.md`](CLOUD-ARCHITECTURE.md)
and the [deployment runbook](wa-translator/cloudflare/DEPLOYMENT.md).
The dated deployment IDs, public probes, tested language counts and remaining
acceptance gaps are maintained in
[`MULTILINGUAL-PRODUCT-HANDOFF.md`](MULTILINGUAL-PRODUCT-HANDOFF.md).

```powershell
cd wa-translator\windows
..\..\.venv\Scripts\python.exe run_room.py
```

It prints a private `https://…/room/<random-code>` invitation. Open it on your
phone, use Share/WhatsApp, and choose the Locale you speak. The application
never receives a telephone number; the share target chooses the recipient.

The local adapter starts in UI/protocol-only mode by default: it does not
download or convert Whisper/M2M100 on Windows, and its capability badge says
that live captions are unavailable. Use the permanent cloud dashboard (and the
Desktop shortcut below) for production captions. An advanced developer may set
`LANG_ROOM_LOCAL_MODEL_LOAD=1` only with an already provisioned, hash-valid
local cache; Windows still never materializes the production model lane.

Full runbook, checks and measured latency: [`wa-translator/windows/README.md`](wa-translator/windows/README.md).
Architecture and the rules the implementation is held to: [`SPEC-v7.md`](SPEC-v7.md).

## Windows host dashboard

The permanent cloud dashboard is
`https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/`.
It creates a participant link, copies or natively shares it, opens the room, and
can terminally close it. A host-control bearer is separate from the participant
URL, stays only in the dashboard's same-device browser storage, and is never
placed in the shared URL, cache, or room history. Closing a room immediately
disconnects callers and keeps a tombstone through the link expiry, so the same
participant URL cannot rejoin.

On this Windows host, the Desktop shortcut is
`C:\Users\MSI\Desktop\Live Translator.lnk`. It launches Edge app mode directly
at the permanent origin; it does not depend on the Codex browser. The shortcut
is device-local: clearing that app's browser storage loses the host control on
this device, but never exposes it to a participant.

Install or repair that one shortcut with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wa-translator\windows\persistent_host.ps1 -Action Install
```

The installer removes the retired login task and its old Open/Start/Stop
shortcuts. It does not start a localhost server. After installation,
double-click `Live Translator` on the Desktop; the shortcut is independent of
this repository and opens the permanent hosted application directly.

## What it does

- **Live captions, not turn-taking.** Text appears ~1.7s after you start
  speaking and keeps growing and correcting itself until you stop.
- **One ASR, multi-target captions.** A source Locale resolves to its base
  Language, transcribes once, then M2M100 translates to up to three unique
  listener base Languages. Same-base Locale listeners share one translation.
- **Optional translated voice.** It starts off. A listener selects an exact
  declared profile, never an inferred biometric or cloned voice. Female/male
  choices are shown only when that Locale has a corresponding enabled profile;
  French currently exposes only its documented female profile.
- **Video.** Peer-to-peer, with the other person filling the top of the screen
  and your own camera as a small inset.

## What it does not do

Stated plainly, because each of these will look like a bug otherwise:

- **The local-development link changes every restart.** Quick tunnels are
  ephemeral. The cloud adapter instead uses a stable `workers.dev` URL.
- **The local adapter has no TURN relay.** The cloud adapter issues short-lived
  TURN credentials without exposing its long-term key.
- **The private link is the key.** It contains 144 random bits, expires after 24
  hours, and is forgotten if the host restarts. Anyone holding that exact link
  can enter, so do not post it publicly. The host supports four total callers.
- **The spoken translation lags the caption.** It speaks whole sentences, only
  once they are final, so you read it before you hear it.
- **Your captions pause while your device is speaking.** Your speaker sits next
  to your microphone; if it kept listening it would transcribe the translation
  and translate it back forever. The other person still hears your real voice
  throughout — only the caption feed is held.
- **Voice quality varies.** The cloud uses revision-pinned Kokoro artifacts
  only for the 13 profiles declared in the catalog. The browser may also offer
  same-language voices installed on the listener's device. Other languages are
  captions-only; the app never substitutes a voice from the wrong language.
- **Model work belongs on the production L4.** The local adapter can use the
  same catalog/contract and can read an already-provisioned CPU M2M100 cache
  for development, but it never downloads, converts, or benchmarks the
  production model lane on this Windows host.
- **The one-L4 stream limit is global.** Each room can contain four people,
  but the single scale-to-zero container has four active caption-stream slots
  shared across all rooms. If other rooms occupy them, the affected speaker
  sees an explicit capacity status; video and natural peer audio remain live.

## Repository layout

| Path | What it is |
|---|---|
| `wa-translator/windows/` | the app — server, ASR, MT, browser UI, checks |
| `wa-translator/cloudflare/` | permanent Worker, one room Durable Object and deployment tests |
| `wa-translator/modal_app.py` | independent authenticated ASR/MT/Kokoro compute |
| `wa-translator/capabilities.json` | one shared Language/Locale/Capability/Voice Profile catalog |
| `wa-translator/MULTILINGUAL-SOURCES.md` | primary-source model, license, revision, artifact-hash and quality-ceiling decision record |
| `wa-translator/` | compute adapters, fixtures, tests, notices and the portable caption filter |
| `SPEC-v7.md` | current architecture; `SPEC.md`–`SPEC-v6.md` are its history |

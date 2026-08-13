# lang — live multilingual video room

One private link, up to four browsers. Camera and natural voice go directly
between peers while a single transcription fans out to the unique base
languages of current listeners. Captions-only is the default; a listener can
independently choose an exact declared synthetic Voice Profile where one is
enabled.

The shared catalog currently declares **100 M2M100 base text Languages**,
**122 BCP-47 Locale profiles**, and **six release-tested live-speech
Languages** (Arabic, German, English, Spanish, French, Japanese). Those counts
are deliberately separate: locale variants such as `es-MX` map to base `es` and
do not claim a distinct ASR/MT model or dialect quality. Production TTS is
enabled for four Languages (English, Spanish, French, Japanese) through nine
pinned profiles; Arabic and German remain captions-only.

There are two adapters. The Windows adapter below is the local development path.
The production beta uses a permanent Cloudflare `workers.dev` room plus a
scale-to-zero Modal GPU and short-lived Cloudflare TURN credentials. It still
has no accounts or database. See [`CLOUD-ARCHITECTURE.md`](CLOUD-ARCHITECTURE.md)
and the [deployment runbook](wa-translator/cloudflare/DEPLOYMENT.md).

```powershell
cd wa-translator\windows
..\..\.venv\Scripts\python.exe run_room.py
```

It prints a private `https://…/room/<random-code>` invitation. Open it on your
phone, use Share/WhatsApp, and choose the Locale you speak. The application
never receives a telephone number; the share target chooses the recipient.

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
  only for the nine profiles declared in the catalog. Unsupported languages are
  captions-only; the local development adapter also stays captions-only rather
  than pretending to reproduce cloud TTS.
- **Model work belongs on the production L4.** The local adapter can use the
  same catalog/contract and CPU M2M100 path for development, but it does not
  download or benchmark the production model lane on this Windows host.

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

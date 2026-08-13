# lang — live bilingual video room

Two people, one link, a browser each. You speak English, they speak Spanish, and
each of you reads the other in your own language while the sentence is still
being said. Camera and natural voice go directly between the two browsers.
Captions-only is the default; each listener can independently replace incoming
natural audio with a selected translated voice.

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
phone, tap 📤, choose WhatsApp and the contact. Both people then tap **Start**
and pick the language they speak. The application never receives the telephone
number; WhatsApp chooses the recipient.

Full runbook, checks and measured latency: [`wa-translator/windows/README.md`](wa-translator/windows/README.md).
Architecture and the rules the implementation is held to: [`SPEC-v7.md`](SPEC-v7.md).

## What it does

- **Live captions, not turn-taking.** Text appears ~1.7s after you start
  speaking and keeps growing and correcting itself until you stop.
- **Both directions.** English→Spanish and Spanish→English, with each
  participant declaring the language they speak.
- **Optional translated voice.** It starts off. Each listener can choose Match
  speaker, Female or Male without changing anyone else's setting. The cloud
  routes English and Spanish through four controlled Kokoro voices; captions
  carry on in every mode.
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
- **Voice quality varies.** The cloud uses revision-pinned Kokoro routes. The
  local adapter has one smaller CPU fallback per language and does not reproduce
  the cloud's female/male choices.
- **The first host run downloads two small voice models** (about 115 MB on
  disk). After that spoken translation, like captions, runs locally with no
  paid service.
- **It needs a CUDA GPU.** Without one both models fall back to CPU, the code
  runs, and the captions lag far behind the conversation.

## Repository layout

| Path | What it is |
|---|---|
| `wa-translator/windows/` | the app — server, ASR, MT, browser UI, checks |
| `wa-translator/cloudflare/` | permanent Worker, one room Durable Object and deployment tests |
| `wa-translator/modal_app.py` | independent authenticated ASR/MT/Kokoro compute |
| `wa-translator/` | Sprint-0 benchmarks that chose the models (whisper.cpp, Moonshine, OPUS-MT latency) and the portable caption filter |
| `SPEC-v7.md` | current architecture; `SPEC.md`–`SPEC-v6.md` are its history |

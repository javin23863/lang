# lang — live bilingual video room

Two people, one link, a browser each. You speak English, they speak Spanish, and
each of you reads the other in your own language while the sentence is still
being said. Camera and voice go directly between the two browsers; the
transcription and translation run on one Windows machine with a GPU.

Free and local. No paid APIs, no accounts, no backend to deploy.

```powershell
cd wa-translator\windows
..\..\.venv\Scripts\python.exe run_room.py
```

It prints an `https://…trycloudflare.com` link. Send it to the other person,
both open it, tap **Start**, pick the language you speak.

Full runbook, checks and measured latency: [`wa-translator/windows/README.md`](wa-translator/windows/README.md).
Architecture and the rules the implementation is held to: [`SPEC-v7.md`](SPEC-v7.md).

## What it does

- **Live captions, not turn-taking.** Text appears ~1.7s after you start
  speaking and keeps growing and correcting itself until you stop.
- **Both directions.** English→Spanish and Spanish→English, with each
  participant declaring the language they speak.
- **Video.** Peer-to-peer, with the other person filling the top of the screen
  and your own camera as a small inset.

## What it does not do

Stated plainly, because each of these will look like a bug otherwise:

- **The link changes every restart.** Cloudflare quick tunnels are random by
  design. A stable address needs a Cloudflare account and a named tunnel.
- **Video needs a workable path between the two networks.** There is no TURN
  relay, so a symmetric NAT or CGNAT on either side kills the video. The page
  says so, and captions keep working — they travel over the WebSocket.
- **Anyone with the link can join**, up to four people, exactly like a video
  call link. There is no password. Do not post the link publicly.
- **Speech is not translated back into speech.** Text only, for now.
- **It needs a CUDA GPU.** Without one both models fall back to CPU, the code
  runs, and the captions lag far behind the conversation.

## Repository layout

| Path | What it is |
|---|---|
| `wa-translator/windows/` | the app — server, ASR, MT, browser UI, checks |
| `wa-translator/` | Sprint-0 benchmarks that chose the models (whisper.cpp, Moonshine, OPUS-MT latency) and the portable caption filter |
| `SPEC-v7.md` | current architecture; `SPEC.md`–`SPEC-v6.md` are its history |

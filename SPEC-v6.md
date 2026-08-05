# WhatsApp Real-Time Video Call Translator — Spec (v6)

> v6 changes from v5, driven by the **iTour link-sharing model**: the product
> is not a local overlay that captures a WhatsApp Desktop call. It's a
> **link-sharing translator** — Person A runs the app on Windows, shares a
> link via WhatsApp, Person B opens it on their phone anywhere in the world,
> and both people see bilingual captions in real time.

## v6 architecture (iTour-style link sharing)

```
Person A (Windows)                     Person B (phone, anywhere)
┌─────────────────────┐                ┌─────────────────────┐
│ translator_app.py   │                │ Browser (web page)  │
│  ├ audio_capture    │◄──WASAPI──────│  getUserMedia mic    │
│  │  (mic + loopback)│                │  Hold-to-talk button │
│  ├ Moonshine ASR    │                │  Captions display    │
│  ├ CTranslate2 MT   │                └──────────┬──────────┘
│  ├ Overlay window   │                           │
│  └ translation_server│◄──WebSocket (ngrok)──────┘
│     (FastAPI+uvicorn)│
└─────────────────────┘
     All ASR+MT on-device
     (free, no paid APIs)
```

### How it works
1. **Person A** runs `translator_app.py` on their Windows machine.
2. The app starts `translation_server.py` — a local FastAPI+WebSocket server.
3. The app (optionally) starts **ngrok** to expose the server with a public HTTPS URL.
4. Person A sends the ngrok URL to Person B via WhatsApp chat.
5. **Person B** taps the link → the browser opens the translator web page.
   - Browser captures Person B's mic via `getUserMedia`.
   - Audio streams to the server as float32 PCM chunks via WebSocket.
6. Person A's audio is captured locally via WASAPI (mic + loopback).
7. **All audio → Moonshine ASR → CTranslate2 MT → captions** on the Windows host.
8. Bilingual captions are pushed back to both Person A's overlay and Person B's browser.

### Why this is better than the v5 local-overlay model
- **Actually works for two people on opposite sides of the planet.** The v5 model
  assumed both parties' audio came from the same machine's WASAPI loopback. That
  only works if the WhatsApp call is on the same PC as the translator. The v6
  link-sharing model works with Person B on their phone anywhere.
- **Person B needs zero installation.** Just a browser. No app, no drivers.
- **All compute stays on Person A's Windows machine.** Free, on-device, no paid APIs.
- **Matches the iTour Translator product model** — share a link, join a conversation.

### Components (v6)

| Component | File | Purpose |
|---|---|---|
| Host GUI | `translator_app.py` | Start/stop, language pair, share link, local overlay |
| Web server | `translation_server.py` | FastAPI + WebSocket; serves web page to Person B |
| Audio capture | `audio_capture.py` | WASAPI loopback + mic (Person A's local audio) |
| ASR | `moonshine_asr.py` | Moonshine small-streaming (one transcriber, two streams) |
| MT | `mt_ct2.py` | CTranslate2 int8 OPUS-MT with caption filter |
| Overlay | `overlay_window.py` | Win32 topmost click-through caption window |
| Web page | (inline in server) | HTML/JS: mic capture, captions, language picker |

### Network
- **Local dev**: `http://localhost:8765` (same network or same machine).
- **Remote (different planet)**: ngrok tunnel → `https://xxxx.ngrok-free.app` URL
  shared via WhatsApp. ngrok free tier gives a stable HTTPS tunnel. No backend to deploy.

### What's built and tested (v6, this machine)
- ✅ `translation_server.py` — FastAPI server, serves web page, WebSocket working.
  - Health endpoint verified.
  - WebSocket connection verified (pair negotiation, lang list).
  - Web page has: getUserMedia mic, Hold-to-Talk button, captions display, language bar.
- ✅ `audio_capture.py` — WASAPI loopback + mic, both streams verified on this hardware.
  - Remote (loopback): 28 chunks/3s, 1600 samples/chunk. ✅
  - Local (mic): 29 chunks/3s, max amplitude 0.0075. ✅
- ✅ `overlay_window.py` — Win32 topmost click-through overlay verified.
  - GDI text rendering with ctypes (CreateFontW, BeginPaint/EndPaint). ✅
  - Bilingual text (original + translated), "translating..." indicator. ✅
  - Screenshot confirms text pixels in overlay region. ✅
- ✅ `mt_ct2.py` — Caption filter verified (5/5 test cases: empty, dup, blank, loop, ok).
  - CTranslate2 int8 OPUS-MT model download/convert logic ready.
- ✅ `moonshine_asr.py` — Moonshine two-stream wrapper (one transcriber, two streams).
  - moonshine-voice 0.1.0 installed, ModelArch.SMALL_STREAMING available.
  - Model auto-download via `get_model_path` / `download_model`.

### What's not yet verified (needs model download or live call)
- Moonshine ASR on live audio (needs ~250 MB model download).
- CTranslate2 MT on live text (needs ~1 GB model download + convert).
- ngrok tunnel to a real remote browser.
- Full end-to-end: Person A speaks → captions appear on Person B's phone.

### Tech stack (v6)
- **Server**: Python 3.11, FastAPI, uvicorn, websockets.
- **ASR**: Moonshine small-streaming via `moonshine-voice` (ONNX Runtime CPU).
- **MT**: CTranslate2 int8 OPUS-MT (Helsinki-NLP models).
- **Audio**: `soundcard` (WASAPI loopback) for host; `getUserMedia` for browser.
- **Overlay**: pywin32 + ctypes GDI (Win32 layered topmost window).
- **Tunnel**: ngrok free tier (HTTPS tunnel, no backend deploy).
- **GUI**: Tkinter (host controller).
- **Web page**: vanilla HTML/JS (no framework, ~3 KB, loads fast on mobile).

### Constraints (unchanged from v5)
- Free for the user. No paid APIs, no subscription backend.
- All ASR+MT on-device on the Windows host.
- Headphones recommended (echo cancellation on browser side).

### Latency expectations (honest, from Gate 1c data)
- ASR per line: 2–4s on CPU (Moonshine small-streaming).
- MT per segment: 47ms (en-zh), 248ms (en-de), 648ms+ fail (en-es).
- Network: ~100-300ms RTT via ngrok (depends on geography).
- End-to-end (mouth → caption): ~3–5s on CPU. Sub-1s only on iPhone ANE (future).
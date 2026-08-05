# wa-translator/windows — Windows Desktop Translator (v6)

WhatsApp Call Translator — iTour-style link sharing. Person A runs this on
Windows, shares a link via WhatsApp, Person B opens it on their phone. Both
see bilingual captions in real time. All ASR + MT runs on-device (free).

## Quick start
```bash
cd wa-translator/windows

# Install deps (one-time)
pip install fastapi uvicorn websockets soundcard pycaw comtypes \
    moonshine-voice sentencepiece ctranslate2 onnxruntime \
    sounddevice pywin32 Pillow mss numpy

# Run the host app
python translator_app.py
```

Then:
1. Select a language pair (en-zh, en-de, en-es, ...)
2. Click **Start**
3. Click **Start ngrok** to get a public URL
4. Send the URL to the other person via WhatsApp
5. They open it on their phone → talk → captions appear on both sides

## Files
| File | Purpose |
|---|---|
| `translator_app.py` | Host GUI (Tkinter): start/stop, link sharing, overlay |
| `translation_server.py` | FastAPI+WebSocket server; serves web page to Person B |
| `audio_capture.py` | WASAPI loopback (speaker) + mic capture, 16kHz mono f32 |
| `moonshine_asr.py` | Moonshine small-streaming ASR (two streams, one transcriber) |
| `mt_ct2.py` | CTranslate2 int8 OPUS-MT + caption filter (loop/dedup/length) |
| `overlay_window.py` | Win32 topmost click-through caption overlay (GDI text) |

## Architecture
```
Person A (Windows)              Person B (phone, anywhere)
┌───────────────────┐          ┌───────────────────┐
│ translator_app    │◄─WASAPI──│  Browser web page   │
│  audio_capture    │          │  getUserMedia mic   │
│  Moonshine ASR    │◄─WebSocket─│  Captions display  │
│  CTranslate2 MT   │  (ngrok)  └───────────────────┘
│  Overlay window   │
│  translation_server│
└───────────────────┘
  All ASR+MT on-device (free)
```

## Status
- ✅ Translation server (FastAPI + WebSocket) — verified
- ✅ Audio capture (WASAPI loopback + mic) — verified on this hardware
- ✅ Overlay window (Win32 topmost, GDI text) — verified
- ✅ Caption filter (loop/dedup/length) — verified
- ✅ Web page (getUserMedia, Hold-to-Talk, captions, lang picker) — verified
- ⏳ Moonshine ASR model download (~250 MB) — code ready, model not downloaded
- ⏳ CTranslate2 MT model download (~1 GB) — code ready, model not downloaded
- ⏳ ngrok tunnel + real remote browser test — ngrok installed, not tested E2E
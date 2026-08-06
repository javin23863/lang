# Live bilingual video room (Windows host)

Two people, one link, a browser each. Camera and call audio go peer-to-peer over
WebRTC; a 16 kHz copy of each microphone comes to this machine, where whisper
transcribes it and OPUS-MT translates it into the other person's language.
Captions appear while you are still talking.

Everything runs locally. No paid APIs.

## Run it

```powershell
cd wa-translator\windows
..\..\.venv\Scripts\python.exe run_room.py          # prints a public https link
..\..\.venv\Scripts\python.exe run_room.py --local  # localhost only
```

Both people open the link, tap **Start**, and pick the language they speak.
`<link>/test` is a mic and camera diagnostic if something looks wrong.

First run downloads ~2 GB of models (whisper large-v3-turbo, two OPUS-MT
directions) into `~/.cache`. After that it works offline.

## What runs where

| File | Job |
|---|---|
| `run_room.py` | starts the server + a cloudflared quick tunnel, prints the link |
| `translation_server.py` | the room: participants, WebRTC signalling relay, audio ingest, caption fan-out |
| `endpointer.py` | Silero VAD — where an utterance starts, how much of it is speech, when it ends |
| `asr_whisper.py` | faster-whisper `large-v3-turbo`, CUDA fp16, explicit per-speaker language |
| `mt_ct2.py` | CTranslate2 OPUS-MT, one engine per direction, plus the caption filter |
| `cuda_dlls.py` | puts the pip CUDA runtime on the DLL search path |
| `static/room.html` | the room UI: video PiP, live caption bubbles, language picker |
| `static/pcm-worklet.js` | mic → 16 kHz mono int16 on the audio thread |

Requires a CUDA GPU for usable latency. Without one both models fall back to CPU
and captions will lag badly — the code runs, the experience does not.

## Checks

```powershell
..\..\.venv\Scripts\python.exe endpointer.py     # VAD gate and endpointing
..\..\.venv\Scripts\python.exe asr_whisper.py    # ASR, incl. the hallucination regression
..\..\.venv\Scripts\python.exe mt_ct2.py         # both directions, loop detection
..\..\.venv\Scripts\python.exe test_room.py      # room plumbing, 10 tests
..\wa-translator\caption_filter_test.py          # portable caption filter, 14 tests

# end to end, against a running server — this is the one that can fail on "too slow"
..\..\.venv\Scripts\python.exe probe_stream.py
```

`probe_stream.py` voids its own run if it could not feed audio at real-time
speed, because a drifting probe reports the app as slow when the app is fine.

### Measured (RTX 3080 Laptop, 8 GB)

| | en → es | es → en |
|---|---|---|
| first live caption, after speech starts | 1.99 s | 1.66 s |
| final caption, after the audio ends | +0.09 s | +0.12 s |
| ASR decode, per call | ~250 ms | ~250 ms |
| MT, per caption | ~30 ms | ~30 ms |

The ~1.7–2.0 s to the first caption is mostly a deliberate wait: below ~0.8 s of
speech whisper answers with confident filler (`"Gracias."`), so the server does
not ask. Decode and translation are ~0.3 s of it.

### Test audio

`../test-audio/{en,es}.wav` are 16 kHz fixtures. They were generated once with
Moonshine's TTS (`moonshine-voice`, `kokoro` voices) — that package is not a
dependency of this app, so regenerate them from any 16 kHz mono recording if
they go missing. The Spanish clip is what the hallucination regression is pinned
to.

## Retired

These are the earlier WhatsApp-call-overlay design and are no longer on the path:
`translator_app.py` (tkinter host), `audio_capture.py` (WASAPI loopback),
`overlay_window.py` (topmost caption window), `moonshine_asr.py`. They still
work for capturing a call playing on this PC; they cannot do a two-person room
with video, which is what the app is now.

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

Setup, once:

```powershell
cd <repo>
uv venv --python 3.11 .venv
uv pip install --python .venv\Scripts\python.exe -r wa-translator\windows\requirements.txt
uv pip install --python .venv\Scripts\python.exe torch --torch-backend cpu
```

### Port

Default **8791**, from `translation_server.DEFAULT_PORT`. It is deliberately not
8765: another application on this machine listens there, and Windows permits a
second process to bind an already-bound port instead of refusing — so the room
starts "successfully" and serves the other app's responses. `run_room.py`
refuses to start if anything already answers on the port; pass `--port` to move.

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
| `static/mictest.html` | the `/test` diagnostic page |
| `probe_stream.py` | abuse guards + real-time caption latency, against a running server |
| `browser_check.py` | two real Chrome tabs: WebRTC, and what the peer actually hears |
| `test_room.py` | room plumbing: queue coalescing, caption shape, ingest gating |

Requires a CUDA GPU for usable latency. Without one both models fall back to CPU
and captions will lag badly — the code runs, the experience does not.

## Checks

Offline, no server needed:

```powershell
$py = "..\..\.venv\Scripts\python.exe"
& $py endpointer.py            # VAD gate and endpointing
& $py asr_whisper.py           # ASR, incl. the hallucination regression
& $py mt_ct2.py                # both directions, loop detection
& $py test_room.py             # room plumbing, 10 tests
& $py ..\caption_filter_test.py   # portable caption filter, 14 tests
```

Against a running server (`run_room.py --local` in another window):

```powershell
& $py probe_stream.py          # abuse guards, then real-time latency
& $py browser_check.py         # two real Chrome tabs: video, and what the peer hears
```

Two of these earn their keep in ways the others cannot:

- `probe_stream.py` is the only check that can fail on *"the captions are too
  slow"*. It also **voids its own run** if it could not feed audio at real-time
  speed — a drifting probe reports the app as slow when the app is fine, which
  is exactly what it did the first time it ran.
- `browser_check.py` is the only check that can fail on *"the other person can
  still hear you"*. It drives two Chrome tabs with fake camera and mic (your real
  devices are never opened) and asserts what the peer receives across Start and
  mute, plus ICE actually reaching `connected`. The published audio track lives
  on the peer connection and in no Python path, so every other check here passed
  while the microphone stayed live through mute.

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

## Known limits

Each of these will read as a bug if it is not stated:

- **The share link changes on every restart.** Cloudflare quick tunnels are
  random by design. A fixed address needs a Cloudflare account and a named
  tunnel (`cloudflared tunnel login`, then `create`/`route dns` and run it
  yourself against `http://localhost:8791`); `run_room.py --local` stays out of
  the way if you do.
- **No TURN server.** Video is peer-to-peer with STUN only, so a symmetric NAT
  or CGNAT on either side kills it. The page says so and captions carry on —
  they ride the WebSocket, not the peer connection.
- **No password.** Anyone with the link can join, up to `MAX_PARTICIPANTS` (4);
  joiner five is told the room is full rather than dropped. Same trust model as
  a video-call link.
- **Partials can be wrong before they are right.** A half-finished sentence is
  translated from half a sentence; the final corrects it. That is the cost of
  captions that keep up with speech.

## Retired

The earlier WhatsApp-call-overlay design — `translator_app.py` (tkinter host),
`audio_capture.py` (WASAPI loopback), `overlay_window.py`, `moonshine_asr.py`,
and the `capture/` and `overlay/` C++ skeletons — was **deleted** in this
rewrite, not merely set aside. The host app drove server endpoints
(`/api/host_audio`, `/api/init_mt`) that the room server no longer has, so it
could not run. Recover from git history if that idea comes back.

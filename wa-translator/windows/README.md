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

## Keep the host running on Windows

Install the local translator as a per-user Windows scheduled task:

```powershell
powershell -ExecutionPolicy Bypass -File .\persistent_host.ps1 -Action Install
```

It starts at Windows sign-in, restarts after a crash, and creates **Open**,
**Start**, and **Stop** shortcuts on the desktop. This keeps the model server
alive independently of Codex. The computer must remain powered on and signed in.

The desktop **Open** shortcut is local to this computer. A permanent phone
bookmark additionally requires a named tunnel and hostname; quick-tunnel
`trycloudflare.com` addresses deliberately change whenever the tunnel restarts.

The printed URL is already a private room invitation. On your phone, open it,
tap 📤, choose WhatsApp and the contact. Both people open that same URL, tap
**Start**, and pick the language they speak. Visiting the server root also shows
a **Create private room** button. Rooms expire after 24 hours and disappear on
host restart; WhatsApp receives the link, while the server never sees the phone
number.
Open `/test` at the same server origin (for example,
`https://your-host.example/test`) for a mic and camera diagnostic.

First run downloads ~2 GB of caption models (whisper large-v3-turbo and two
OPUS-MT directions), plus about 115 MB of English/Spanish voice models, into
`~/.cache`. After that, speech recognition, translation, and voice generation
run locally; remote callers still need the host, network, and HTTPS tunnel.

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
| `static/index.html` | phone landing page that creates a private room with an explicit POST |
| `endpointer.py` | Silero VAD — where an utterance starts, how much of it is speech, when it ends |
| `asr_whisper.py` | faster-whisper `large-v3-turbo`, CUDA fp16, explicit per-speaker language |
| `mt_ct2.py` | CTranslate2 OPUS-MT, one engine per direction, plus the caption filter |
| `tts_local.py` | sherpa-onnx CPU voices used when the browser has no matching language voice |
| `cuda_dlls.py` | puts the pip CUDA runtime on the DLL search path |
| `static/room.html` | the room UI: video PiP, live caption bubbles, language picker |
| `static/pcm-worklet.js` | mic → 16 kHz mono int16 on the audio thread |
| `static/mictest.html` | the `/test` diagnostic page |
| `probe_stream.py` | abuse guards + real-time caption latency, against a running server |
| `browser_check.py` | two real Chrome tabs: WebRTC, peer media, and audible translated WAV playback |
| `live_bilingual_check.py` | deployed six-turn semantic room, real browser mic/AudioWorklet, real Kokoro playback, background/resume |
| `test_pcm_worklet.cjs` | audio-thread mute/unmute cursor and bounded-frame regression |
| `test_room.py` | room plumbing: private links/isolation, queue coalescing, caption shape, ingest gating |

Requires a CUDA GPU for usable latency. Without one both models fall back to CPU
and captions will lag badly — the code runs, the experience does not.

## Checks

Offline, no server needed:

```powershell
$py = "..\..\.venv\Scripts\python.exe"
& $py endpointer.py            # VAD gate and endpointing
& $py asr_whisper.py           # ASR, incl. the hallucination regression
& $py mt_ct2.py                # both directions, loop detection
& $py test_room.py             # room plumbing + private invitations, 15 tests
& $py ..\caption_filter_test.py   # portable caption filter, 14 tests
```

Against a running server (`run_room.py --local` in another window):

```powershell
& $py probe_stream.py          # abuse guards, then real-time latency
& $py browser_check.py         # two real Chrome tabs: video, and what the peer hears
& $py live_bilingual_check.py  # public-only, slow: six real bilingual turns and real TTS
node --test test_pcm_worklet.cjs
```

Two of these earn their keep in ways the others cannot:

- `probe_stream.py` is the only check that can fail on *"the captions are too
  slow"*. It also **voids its own run** if it could not feed audio at real-time
  speed — a drifting probe reports the app as slow when the app is fine, which
  is exactly what it did the first time it ran.
- `browser_check.py` is the only check that can fail on *"the other person can
  still hear you"* or *"the translated WAV never really played"*. It drives two
  Chrome tabs with fake camera and mic (your real devices are never opened),
  asserts the peer media across Start and mute, and requires English and Spanish
  fallback audio to resolve, enter `playing`, advance, and end without error. It
  also checks native/WhatsApp sharing and every control at a 360 px phone width.
- `live_bilingual_check.py` is the deployment acceptance gate. Unlike the fast
  browser check, it never injects a caption or replaces `fetch`: revision-pinned
  Kokoro phrases enter two Chrome processes as microphone input, the real room
  produces six semantically checked ASR/MT finals, and each listener must decode
  and finish three non-silent production TTS WAVs in their selected language.
  It keeps the call alive beyond the presence lease, records the selected ICE
  candidate type, and freezes/resumes one client. This proves observable media
  events, not that a human heard the sound; human-audible acceptance remains a
  separate manual check.

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
- **No account or password.** The 144-bit room URL is the bearer key. It has a
  hard 24-hour lifetime, is lost on host restart, and must be sent privately.
  The host-wide `MAX_PARTICIPANTS` limit remains 4; caller five is told the room
  is full rather than dropped.
- **Partials can be wrong before they are right.** A half-finished sentence is
  translated from half a sentence; the final corrects it. That is the cost of
  captions that keep up with speech.
- **Spoken translation is off by default.** When enabled against this local
  adapter, the host generates a local CPU WAV. The fallback models are
  cached under `~/.cache/lang-room/tts` (override with
  `LANG_ROOM_TTS_CACHE`). The Spanish fallback is deliberately small, so it is
  less natural than many phone voices. The shared UI's Female/Male choice is a
  cloud Kokoro feature; the local adapter has one public-domain voice per
  language and accepts the style field only for protocol compatibility.
- **It speaks finals only**, so you read a sentence before you hear it. While it
  speaks, your caption feed is paused — otherwise your speaker feeds your
  microphone and the room translates itself in a loop. The peer connection is
  untouched, so the other person still hears your real voice. Enabling 🔊
  locally mutes incoming natural audio before playback; any voice failure
  switches safely back to captions-only and restores it.

## Retired

The earlier WhatsApp-call-overlay design — `translator_app.py` (tkinter host),
`audio_capture.py` (WASAPI loopback), `overlay_window.py`, `moonshine_asr.py`,
and the `capture/` and `overlay/` C++ skeletons — was **deleted** in this
rewrite, not merely set aside. The host app drove server endpoints
(`/api/host_audio`, `/api/init_mt`) that the room server no longer has, so it
could not run. Recover from git history if that idea comes back.

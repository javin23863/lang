# Live bilingual video room — Spec (v7)

> v7 replaces v6's host-app-plus-guest-browser model with a **symmetric browser
> room**. Both people open the same link. They see each other. They speak their
> own language and read the other's. The Windows machine is no longer a
> participant — it is the compute.

## Why v6 could not do this

v6 assumed Person A ran a tkinter app that captured their own audio via WASAPI
while Person B used a browser. Three things made that the wrong shape:

1. **No video.** The product is a conversation between two people who want to see
   each other. v6 had no camera path at all.
2. **One direction.** ASR was hardcoded to English (`get_model_for_language('en')`)
   and MT shipped only `en-*` pairs. Spanish speech was transcribed as broken
   English and never translated — the stated use case could not work.
3. **Asymmetry with no payoff.** The host needed an install, drivers, and a GUI
   to do what the guest did with a browser tab.

## v7 architecture

```
Browser A (en)  ──── WebRTC P2P: camera + voice ────  Browser B (es)
      │                                                      │
      └──── WebSocket: 16kHz int16 PCM + control/signalling ─┘
                               │
                 translation_server.py (Windows, CUDA)
                   faster-whisper large-v3-turbo (fp16)
                   CTranslate2 OPUS-MT en→es / es→en (int8_float16)
                   Silero VAD endpointing, rolling partials
                               │
                     captions fan out to the room
```

Video and call audio never reach the server: it relays SDP and ICE without
parsing them. Only the ASR feed is uploaded, downsampled in the browser to
16 kHz int16 — ~32 KB/s per speaker instead of v6's ~192 KB/s, which matters
because the other person's phone is also carrying the video uplink.

## Captions

Each utterance produces a stream of **partials** (every 400 ms, from ~0.8 s of
speech onward) and one **final** when the speaker stops for 500 ms. Partials are
translated too, so the reader watches the sentence assemble in their own
language.

Every caption carries `speaker` (a participant id), `speaker_lang`, `seq`, and a
`translations` map keyed by language. **No caption carries a "me"/"remote"
label.** v6 computed that server-side and broadcast it, so both people saw
themselves as the speaker of every line. The client compares `speaker` to its
own id.

## Rules the implementation is held to

- **A partial may supersede a partial; nothing may supersede a final.** The GPU
  queue drops a speaker's older partial when a newer one arrives — decoding audio
  the speaker has already moved past pushes every later caption further behind.
- **Gate on speech duration, never buffer duration.** A buffer holds the silence
  before the first word too. Gating on its length let 0.5 s of speech reach the
  model as if it were 0.9 s, and whisper answered with invented filler.
- **Whisper's confidence cannot be used to detect its own hallucinations.** It
  returns `"Gracias."` for 0.6 s of Spanish with `no_speech_prob=0.0` and a
  healthy `avg_logprob`. The defenses that work are the Silero gate and the
  minimum speech duration; a logprob filter was tried, measured, and removed.
- **Marian source tokens end with `</s>`.** Without it the decoder re-translates
  the input forever. Gate 1b recorded this as "en-es is slow and loops" and
  blamed the model; it was the tokenizer, and it affected every pair.
- **Video failure is stated, not shown as a black rectangle.** There is no TURN
  server, so strict NAT kills the P2P video. The page says so and the captions
  keep running.

## Not in v7

Spoken translation (TTS out). The seam is the final-caption event; the installed
Moonshine package already exposes voices for Spanish and English.

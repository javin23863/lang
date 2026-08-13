# Live bilingual video room — Spec (v7)

> **Cloud extension:** this document remains the local-adapter specification.
> The production cloud room, captions-only default, per-listener translated
> voice modes, controlled Kokoro routes, TURN and Durable Object ownership are
> specified in [`CLOUD-ARCHITECTURE.md`](CLOUD-ARCHITECTURE.md). Where the two
> differ for cloud behavior, that architecture is authoritative.

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

## Private invitations

The local adapter creates a 144-bit URL-safe participant bearer; the permanent
Worker creates an HMAC-signed participant bearer. The room URL is
`/room/<token>` and its WebSocket is `/ws/<token>`; the path—not a
client-supplied join field—is authoritative. Peer discovery, signalling,
language targets, captions, updates and leave events are all filtered by that
room identity. Globally unique participant ids remain useful, but knowing an id
in another room does not make it a valid signalling target.

Creation also returns a distinct room-bound host-control bearer to the
same-origin dashboard only. It uses a domain-separated signature in the Worker
and is stored locally on the creator device; it is never embedded in the
participant URL. The authenticated `GET /api/room-control` and
`POST /api/room-control/close` interfaces inspect or revoke only that one room.
Revocation closes active sockets with `room_closed`/code 4001, cancels compute,
and retains a tombstone through expiry so later page, preflight, and WebSocket
access cannot resurrect the participant link.

The host dashboard shares its participant URL through `navigator.share`, which
lets the device choose WhatsApp and the contact when that native facility is
available. Its fallback copies the link; neither path sends a telephone number
to this server.

The local development adapter keeps rooms in memory for a hard 24 hours.
Unknown and expired HTTP URLs return the same generic 404; their WebSockets
close with policy code 1008 and the client stops reconnecting. Existing
connected local calls may finish after expiry. A process restart invalidates
every local room, and the quick-tunnel hostname can disappear sooner. Permanent
Worker revocations instead retain their Durable Object tombstone through expiry.
Room pages are `no-store` and use `Referrer-Policy: no-referrer` because the
path itself grants access.

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

## Spoken translation

Each **final** caption addressed to you is also spoken aloud, in your language.
Partials are never spoken: they are rewritten as the sentence lands, so
speaking them would stutter and repeat.

The browser's `speechSynthesis` is the first path only when it exposes an exact
or base-language match. The presence of the API alone is not enough: Chromium
can expose English voices and no Spanish voice, then silently read Spanish with
its default English voice. When the requested language is missing, the client
POSTs the final caption to authenticated `/tts` and plays the returned binary
WAV through one reusable, user-unlocked audio element.

The local Windows fallback is CPU-only: `sherpa-onnx` runs
`en_US-ljspeech-medium` and `es_ES-carlfm-x_low`. The deployed cloud path uses
revision-pinned Kokoro on the same Modal L4 service as Whisper and MT, with one
bounded TTS input separate from the four caption streams. The local model data
is public-domain and the runtime is Apache-2.0; its two model directories total
about 115 MB and are cached after first download. HTTP keeps audio ownership,
cancellation, and backpressure separate from ordered captions and WebRTC
signalling in both paths.

**The feedback loop is the hazard, not the synthesis.** Your speaker is
centimetres from your microphone: left alone, the translation is transcribed as
though you had said it, translated back, and spoken again, forever. The ASR feed
is therefore held shut for the duration of the utterance plus a short tail, and
`asrPaused` outranks the mic button so unmuting mid-utterance cannot reopen it.
The peer connection stays live throughout — only the caption feed is paused, so
the other person still hears your real voice.

`browser_check.py` asserts all of it: partials and your own finals stay silent,
native speech uses the requested language, and both fallback languages decode,
enter `playing`, advance through nonzero audio, and end. It also covers serial
queueing, cancellation, and ASR pause/resume. Removing the pause leaves the
speech working and the check failing, which is the point.

## Not in v7

Voice-to-voice translation — speaking in the *other person's* voice, or
translating speech without passing through text. Both need a different model
class than the transcribe-then-translate pipeline this is built on.

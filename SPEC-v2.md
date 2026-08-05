# WhatsApp Real-Time Video Call Translator — iOS App Spec (v2)

> Revision v2. Changes from v1: (1) **free-only** stack — no paid APIs, no paid TURN, no subscription backend; (2) leads with a **Sprint 0 spike** that proves call-audio capture before any architecture is built; (3) replaces the unworkable on-device `SFSpeechRecognizer` default with **whisper.cpp** (no session limit, free, offline); (4) drops the iTour browser-join path from v1 scope because a relayed WebRTC backend is not free to host at call quality — it becomes a later paid tier; (5) fixes the local-overlay problem with a real PiP-caption-video mechanism; (6) adds echo handling and failure modes.

## Hard constraint
**Zero recurring cost for the user (me).** No Deepgram, DeepL, GPT, OpenAI Realtime, paid TURN, or hosted SFU. Everything runs on-device or on free-tier self-hosted infra. This single constraint reshapes the whole plan vs. v1.

## The one question that decides everything
**Can a ReplayKit Broadcast Upload Extension actually receive non-silent audio samples from an active WhatsApp video call on iOS?**

- v1 assumed yes and built an architecture on it. That was backwards.
- Apple forums and the Broadcast Extension contract say `RPSampleBufferType.audioApp` delivers *app audio output*. WhatsApp call audio is VoIP-session audio, not media playback — it is **not guaranteed** to appear in `audioApp` samples. Some devs report silence; some report it works on certain iOS versions.
- **Nothing in this spec is built until that question is answered with code.**

### Sprint 0 — the spike (do this first, nothing else)
A 60-line iOS app + Broadcast Upload Extension that does exactly this during a live WhatsApp video call:

1. `RPSystemBroadcastPickerView` → user taps Start Broadcast.
2. `SampleHandler` receives every `CMSampleBuffer` of type `.audioApp` and `.audioMic`.
3. For each buffer: log `sampleRate`, `channelCount`, `presentationTimeStamp`, and **RMS amplitude** (to detect silence) — separately for mic vs app-audio.
4. Save the log to the App Group container; the main app displays it.

**Pass condition:** during a 30-second WhatsApp call, the `.audioApp` stream shows non-zero RMS that varies when the remote party speaks. If it's silent or constant, **the capture path is dead** and the entire v1 architecture is invalid — pivot to the fallback below.

**Time budget:** 1 day. If this isn't proven in a day, stop and reconsider.

**If the spike FAILS (likely) — the fallback is the only real plan:**
The app becomes a **companion that joins the same WhatsApp call via a second device/browser** — i.e. you start a WhatsApp call on your phone, and a browser tab on a laptop joins the same conversation through a free WebRTC peer you host yourself, captures audio there, and pushes captions back to the phone as a Live Activity. This is closer to iTour's actual model and it's free for one user. It's also a different product than "iPhone overlay app." This spec picks the path after the spike, not before.

The rest of this document assumes the spike **passes**. If it fails, see "Fallback B" at the end.

---

## What the app does (v1, spike-passing path)
A standalone iPhone app that, while you're on a WhatsApp video call, shows **live bilingual captions** on top of WhatsApp using Picture-in-Picture, transcribed and translated entirely on-device for free. No backend, no paid API, no friend-side install. The remote party's audio is captured by a Broadcast Extension; your mic is captured the same way.

## Architecture (assumes spike passed)

### Capture layer
- **ReplayKit Broadcast Upload Extension** (`RPBroadcastSampleHandler`).
- Receives two tagged streams:
  - `.audioMic` → local caller (you).
  - `.audioApp` → remote caller (WhatsApp speaker output). *Only if the spike proves this is non-silent.*
- Buffers shipped to the main app via an **App Group shared container** (not a ring buffer — a flat file written by the extension and streamed-read by the app; ring buffers across the extension boundary are flaky on iOS).
- The extension does **only** capture + write. No ASR, no MT — it will blow the 50 MB cap otherwise (v1 mistake, fixed).

### ASR layer — whisper.cpp, not Apple Speech
v1 defaulted to `SFSpeechRecognizer`. That has a **~60-second streaming session limit** and stops on silence. A WhatsApp call is 10–60 minutes. v1 ignored this. It's a hard blocker.

**v2 uses whisper.cpp** (MIT, free, on-device):
- `whisper.cpp` Swift bindings (`whispercpp` SPM package, or the `WhisperKit` pod which wraps it).
- Model: `ggml-base.en` for English-remote (39 MB) or `ggml-small` for multilingual (244 MB) — both free, downloadable at first launch.
- Streaming mode: sliding 2-second window, emit partials every ~500 ms, finalize on 1.5 s of silence (VAD-gated).
- **No session limit.** Runs as long as the call runs.
- Runs in the **main app process**, not the extension (extension is capture-only).
- Two parallel whisper contexts, one per stream (local mic, remote app-audio), so speakers don't collide.
- Fallback: Apple `Speech` framework is *not* used for streaming — only for one-shot short utterances if ever needed. It's off the critical path.

### MT layer — Apple Translation framework
- `Translation` framework (iOS 17.4+), on-device, offline, free.
- Sentence-level. We feed it finalized ASR segments, not partials (partials are too noisy for it).
- Partial-to-final cadence: whisper emits a finalized segment every ~1.5 s → translate → caption. So caption update rate is **~1–2 s**, not 300 ms. v1's 300 ms target was fantasy; v2 is honest about cadence.
- Language pair set by the user up front (no auto-detect in v1 — auto-detect adds latency and errors).

### Overlay layer — the real solution for the local viewer
v1 listed three overlay options and didn't pick one. v2 picks one that actually works on iOS:

**Picture-in-Picture caption video.**
- The app keeps a tiny PiP window active using `AVPictureInPictureController` with a **`AVSampleBufferDisplayLayer`** rendering a generated video frame of the current caption text.
- PiP floats over WhatsApp (iOS allows PiP over other apps). This is the only sanctioned way to draw over another app.
- The "video" is just a black semi-transparent box with white caption text, redrawn at 2 fps (low, because caption cadence is 1–2 s anyway).
- When the call ends, PiP closes.
- **Live Activity** is a *secondary* display (lock-screen rolling caption, throttled to Apple's push limits — sentence-level, not word-level). Not the primary overlay.

### Echo handling
v1 shipped software-only with zero echo handling. v2 is explicit:
- **v1 app guidance: use wired or Bluetooth headphones.** Speakerphone will cause the mic to pick up the remote party's voice from the speaker and re-transcribe it (feedback loop of wrong captions). This is the same constraint iTour's earbuds exist to solve.
- No software AEC in v1. It's too brittle to ship first. Headphones are the requirement, stated in the onboarding screen.
- Software AEC (Apple's `AVAudioEngine` voice-processing mode) is a v2 feature once the core works.

## Features (v1 — MVP, free)
1. Start session → broadcast picker → start Broadcast Extension.
2. Pick language pair (my language / their language), each from the ~12 languages Apple Translation supports offline.
3. Live bilingual captions in a PiP window over WhatsApp: original line + translated line, speaker tag (You / Them).
4. Lock-screen Live Activity with the latest finalized caption (throttled).
5. Pause / resume.
6. Save transcript (SwiftData, local, encrypted) after the call.
7. First-launch model download (whisper model, one-time, ~40–250 MB over Wi-Fi).

## Non-features (v1)
- No browser-join for the friend (that's the paid-tier product, see Fallback B).
- No text-chat translation.
- No voice-message translation.
- No Android.
- No call recording (transcript only).
- No auto language detection.
- No software echo cancellation (headphones required).

## Tech stack (all free)
- Swift 6, SwiftUI.
- ReplayKit Broadcast Upload Extension.
- whisper.cpp via `WhisperKit` SPM (MIT) — free, on-device, no session limit.
- Apple `Translation` framework — free, on-device.
- Apple `Speech` framework — **not** used for streaming (session limit); reserved for future short-utterance features.
- `AVPictureInPictureController` + `AVSampleBufferDisplayLayer` for overlay.
- `ActivityKit` Live Activity.
- SwiftData for transcripts.
- No backend. No signaling server. No TURN. The app is fully local.

## Permissions / entitlements
- `NSMicrophoneUsageDescription`.
- Broadcast Upload Extension target, `com.apple.developer.replaykit.broadcast`.
- `UIBackgroundModes`: `audio` (keep app alive while WhatsApp is foreground).
- App Group for extension↔app file sharing.
- Live Activity entitlement.
- Model download: no special entitlement; ship `.ggml` files in app bundle or download on first launch.

## Project structure
```
WhatsAppCallTranslator/
├─ App/
│  ├─ Views/
│  │  ├─ HomeView.swift              # start, language pair picker
│  │  ├─ OnboardingView.swift        # headphones requirement, model download
│  │  ├─ CaptionPiPView.swift        # PiP caption renderer
│  │  ├─ LiveActivity/
│  │  │  └─ CallTranslationActivity.swift
│  │  └─ HistoryView.swift
│  ├─ Pipeline/
│  │  ├─ AudioReader.swift           # reads shared file from extension
│  │  ├─ WhisperStreamer.swift       # whisper.cpp wrapper, 2 streams
│  │  ├─ TranslationStreamer.swift   # Apple Translation wrapper
│  │  └─ CaptionAggregator.swift
│  ├─ PiP/
│  │  └─ CaptionVideoRenderer.swift  # builds CMSampleBuffer of caption frames
│  └─ Persistence/
│     └─ TranscriptStore.swift       # SwiftData
├─ BroadcastExtension/
│  └─ SampleHandler.swift            # capture + write to App Group file
└─ Shared/
   └─ AppGroupConfig.swift
```

## Data flow (one caption, end to end)
1. User on WhatsApp call, headphones in, starts Broadcast from the app.
2. `SampleHandler` gets `.audioMic` and `.audioApp` buffers, writes them to a shared file tagged with stream + timestamp.
3. `AudioReader` in the main app tails the file, splits into two PCM streams.
4. `WhisperStreamer` runs two sliding-window whisper contexts → finalized segments every ~1.5 s per stream.
5. `TranslationStreamer` translates each finalized segment via Apple Translation.
6. `CaptionAggregator` emits `CaptionLine { speaker, original, translated, ts }`.
7. `CaptionVideoRenderer` renders the line into a video frame → PiP shows it over WhatsApp.
8. `CallTranslationActivity` updates the Live Activity (throttled to one push per finalized segment).
9. On call end, `TranscriptStore` saves the full transcript.

## Performance targets (honest, v2)
- End-to-end latency (mouth → caption in PiP): **2–4 seconds.** Not 1.5 s. whisper.cpp on an A15+ does ~1 s for a 2 s window; translation adds ~0.5 s; render adds frames. 2–4 s is the real number. Slower than EzDubs' cloud claim, but free and private.
- Caption cadence: one new line every 1.5–2 s (sentence-level, not word-level).
- CPU: two whisper-small contexts = ~80% on an A15. Acceptable for a call; battery is the cost.
- Extension memory: capture-only, well under 50 MB.

## Failure / edge cases (v1 had none)
- **ASR returns garbage** — show the original line untranslated; don't drop the caption.
- **Wrong language picked** — user can swap the pair mid-call; pipeline flushes the current segment.
- **WhatsApp drops the call** — detect audio-app stream going silent > 5 s → auto-stop, save transcript.
- **Broadcast Extension killed by OS** (~30 s after the app backgrounds hard) — keep the app foregrounded via the PiP window (PiP keeps the app's audio session alive); warn the user if the extension dies.
- **No headphones** — onboarding screen blocks start; explain the feedback problem.
- **whisper model not downloaded** — block start until the chosen model is on disk.
- **Remote party silent (app-audio stream is zero)** — fall back to mic-only captions of the local user; show a "remote audio not captured" banner. This is the spike-failure case surfacing at runtime.

## Open questions (real ones, not hand-waved)
1. **Does `audioApp` capture WhatsApp call audio?** — Sprint 0 spike. Decides everything.
2. **whisper.cpp two-stream CPU on a real device** — benchmark on an A15 vs A17. May need to drop to one stream (remote only) and skip local captions.
3. **PiP caption video frame rate** — 2 fps is fine for reading; confirm PiP doesn't get killed by the system for "no real video."
4. **Apple Translation language coverage** — confirm the 12-ish offline pairs cover the user's actual languages before building UI around them.

## Fallback B — if the spike fails (the likely path)
The capture-based overlay app is impossible. Pivot to the iTour-actual model, scoped to free-for-one-user:

- You run a **WhatsApp video call on your phone** (normal).
- A **browser tab on your own laptop** joins a free WebRTC room you host on a free-tier VM (Fly.io free / Oracle Cloud Always Free / home Raspberry Pi).
- The browser tab captures the laptop mic + speaker (the call audio if you route it there, or you just put the phone on speaker near the laptop mic — low-tech but free).
- A **whisper.cpp + Apple-Translation-equivalent** runs on the laptop (Python, free) and captions the call.
- Captions are pushed to the phone as a **Live Activity** via a free push (APNs free tier, or a websocket over the free VM).
- The phone shows captions; the laptop shows captions. No paid API. No friend-side install.
- This is a different product (laptop + phone, not phone-only) but it's the free, actually-works version of iTour's browser-join flow.

Fallback B is **not** built until the spike fails. But it's named here so the plan isn't a dead end if (when) capture doesn't work.

## Deliverables for v1 (spike-passing path)
1. Sprint 0 spike app (capture + RMS log). **Gate.**
2. whisper.cpp two-stream prototype on a recorded call audio file (no extension yet). **Gate.**
3. PiP caption renderer prototype showing fake captions over WhatsApp. **Gate.**
4. Full app: extension + pipeline + PiP + Live Activity + transcript save.
5. App Store submission materials + privacy policy (transcripts only, no audio leaves the device).

## References
- iTour Chat Translation PC: https://www.itourtranslator.com/pages/itour-chat-translation-pc
- iTour cross-app flow: https://www.itourtranslator.com/blogs/news/cross-app-voice-video-translation-made-easy
- Apple ReplayKit: https://developer.apple.com/documentation/replaykit
- whisper.cpp: https://github.com/ggerganov/whisper.cpp
- WhisperKit (Swift): https://github.com/argmaxinc/WhisperKit
- Apple Translation framework: https://developer.apple.com/documentation/translation
- Apple `Speech` session limits (why we don't use it for streaming): https://developer.apple.com/forums/tags/speech
- Forasoft iOS screen sharing (Broadcast Extension memory cap): https://www.forasoft.com/blog/article/how-to-implement-screen-sharing-in-ios-1193
- Competitor survey: https://www.aiphone.ai/blog/best-apps-for-real-time-video-call-translation-on-whatsapp/
- GitHub `javin23863/lang`: empty repo (README only) — greenfield build.
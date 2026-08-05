# WhatsApp Real-Time Video Call Translator — iOS App Spec

## Overview
An iOS app that overlays **live bilingual subtitles** on top of an active WhatsApp video call. It listens to both sides of the conversation, transcribes speech → text, translates in real time, and renders floating subtitles on screen (like the iTour Chat Translation PC app, but as a standalone iPhone app). The remote party needs **no app install** — they join via a browser link, exactly like iTour's desktop flow.

**Scope:** WhatsApp video calls only (voice calls + text-chat translation are out of scope for v1). Focus = instant voice→text + translation overlay during a live WhatsApp video call.

## Reference (iTour desktop app flow)
From https://www.itourtranslator.com/pages/itour-chat-translation-pc and https://www.itourtranslator.com/blogs/news/cross-app-voice-video-translation-made-easy:

1. User opens iTour → taps **Video Call** → picks target app (WhatsApp).
2. Sets friend's language + call type → taps **Invite** → generates a link.
3. Sends link via WhatsApp to the friend.
4. Friend clicks link → **joins via browser** (no app install).
5. Both sides get live on-screen bilingual subtitles. iTour runs in the background and captures system audio + mic.

iTour's desktop build is shipped as native Windows (.zip) / Mac (.pkg) installers and works by screen+audio capture and overlay rendering. The iPhone version below mirrors that architecture but uses iOS-native capture APIs.

## Core Architecture (iOS)

The app is a **translator companion** that runs *alongside* WhatsApp — it does not intercept WhatsApp's data. It captures audio and renders an overlay; the actual WhatsApp call stays in WhatsApp.

### Capture layer (how we hear the call)
iOS does **not** let one app read another app's audio directly. Three viable approaches:

| Approach | Mechanism | Notes |
|---|---|---|
| **A. ReplayKit Broadcast Extension** | `RPSystemBroadcastPickerView` → user starts a Broadcast Upload Extension that receives `CMSampleBuffer` audio+video from the whole device | Survives WhatsApp going to foreground; standard App-Store-safe pattern (Forasoft, Apple docs). This is the primary capture path. |
| **B. ScreenCaptureKit (iOS 26+)** | `SCStream` with audio-only content filter | Newer replacement for ReplayKit; lower overhead; iOS 26+. Fallback/upgrade path. |
| **C. Companion relay (desktop-style link join)** | Mirroring iTour exactly: app generates a join link; the *friend* joins a browser WebRTC room; the app captures only the local mic + local screen audio of WhatsApp speaker output | Works without a Broadcast Extension; matches iTour's "friend joins via browser" model. Best fallback if Broadcast Extension audio of remote party is restricted. |

**Recommended v1:** Approach **A** (Broadcast Extension) for full-duplex capture of both the local mic and the remote speaker audio coming out of WhatsApp, with Approach **C** as the iTour-identical fallback when only local-side capture is permitted.

Two audio streams are fed to the pipeline:
- **Local stream** — caller's own mic (captured by Broadcast Extension mic input).
- **Remote stream** — WhatsApp's speaker output (captured by Broadcast Extension app-audio input).

### Translation pipeline
```
Audio buffers (local + remote, tagged)
  → VAD (voice activity detection, per stream)
  → Streaming ASR (per stream, language auto-detect or user-set)
  → Partial + final transcripts
  → MT engine (streaming translate, src→dst per stream)
  → Bilingual subtitle line (original + translated)
  → Overlay renderer (PiP-style floating caption window)
```

### Overlay renderer
- A floating, semi-transparent caption bar drawn **above** WhatsApp using a system-wide overlay.
- iOS option: render the captions inside the **Broadcast Extension's host app** window kept as a small PiP `AVPictureInPictureController`/`PIP`-style overlay while WhatsApp is foreground, OR draw captions into the broadcast video itself (visible only to the friend in the browser, not locally).
- Local overlay limitation: iOS does not allow one app to draw over another app's UI. Workarounds:
  1. **Live Activity / Dynamic Island** — show rolling bilingual captions as a Live Activity while the call is active (best Apple-sanctioned option).
  2. **PiP overlay** — keep a tiny PiP window with captions visible over WhatsApp.
  3. **Captioned broadcast video** — burn captions into the outgoing browser stream so the friend sees them; local user reads them from the Live Activity.
- **Recommended:** combine Live Activity (local view) + burned-in captions on the browser stream (remote view). This is the closest iOS-legal analog to iTour's desktop overlay.

## Features (v1 — MVP)
1. **Start translator session** — one button → opens `RPSystemBroadcastPickerView` to start the Broadcast Extension.
2. **Pick language pair** — "My language" + "Friend's language" (auto-detect optional).
3. **Generate invite link** — create a WebRTC room; share via WhatsApp deep link. Friend joins in browser, sees captions (iTour parity).
4. **Live bilingual subtitles** — original + translated, scrolling, with speaker tag (You / Them).
5. **Live Activity** — rolling captions on the lock screen / Dynamic Island while the call runs.
6. **Pause / resume** translation.
7. **Session history** — save transcript + translation of the call (local only, encrypted).
8. **On-device option** — toggle to run ASR+MT on-device (privacy) vs cloud (lower latency, more languages).

## Non-features (v1)
- No text-chat translation inside WhatsApp threads.
- No voice-message translation.
- No Android build.
- No call recording (transcripts only, no audio storage).
- No modifications to WhatsApp itself; not a WhatsApp wrapper.

## Tech Stack
- **Language:** Swift 6, SwiftUI for UI.
- **Capture:** ReplayKit Broadcast Upload Extension (`RPBroadcastSampleHandler`); ScreenCaptureKit fallback on iOS 26+.
- **ASR (streaming):**
  - On-device: Apple `Speech` framework (`SFSpeechRecognizer` streaming) — free, private, ~40 languages.
  - Cloud: Deepgram Streaming API or OpenAI Realtime API — sub-300 ms, 100+ languages, accent-robust. Configurable.
- **MT (streaming):**
  - On-device: Apple `Translation` framework (iOS 17.4+) — free, offline, sentence-level.
  - Cloud: DeepL / Google Translate / GPT-4o-mini streaming — pick per language pair for quality.
- **Overlay:** `ActivityKit` Live Activity + `AVPictureInPictureController` for local captions; burned-in captions on outgoing WebRTC track for remote.
- **Signaling / remote join:** WebRTC (Google's `WebRTC` Swift pod or LiveKit SDK) — matches iTour's "friend joins via browser" model.
- **Backend (minimal):** Lightweight relay server (Node.js or Go) only for WebRTC signaling + room creation. No media stored. Self-host or Fly.io.
- **Persistence:** SwiftData for transcripts; Keychain for API keys.

## iOS Permission & Entitlement Requirements
- `NSMicrophoneUsageDescription` — mic access.
- `NSLocalNetworkUsageDescription` — WebRTC signaling.
- Broadcast Upload Extension target (separate bundle id, `com.<app>.broadcast`).
- `com.apple.developer.replaykit.broadcast` — broadcast extension entitlement.
- `UIBackgroundModes` — `audio`, `voip` (to keep the session alive while WhatsApp is foreground).
- Live Activity entitlement (`ActivityKit`).
- App Store: must justify screen+audio capture; declare "screen translation during VoIP calls" use case. ReplayKit Broadcast is App-Store-approved for this (Forasoft case study, similar apps: AI Phone, EzDubs, iTour mobile).

## App Store Risk Notes
- Apple allows Broadcast Extensions for screen/audio capture when the user explicitly starts them (no silent capture). The user taps "Start Broadcast" — fine.
- Drawing over WhatsApp is **not** allowed; we use Live Activity + PiP instead of a true system overlay. This is the iOS-legal equivalent of iTour's desktop overlay.
- Must not store or transmit call audio. Transcripts only. Privacy policy required.

## Project Structure
```
WhatsAppCallTranslator/
├─ App/                          # main iOS app target
│  ├─ Views/
│  │  ├─ HomeView.swift           # start session, language pick
│  │  ├─ InviteView.swift         # generate + share link
│  │  ├─ CaptionOverlayView.swift # PiP / Live Activity UI
│  │  └─ HistoryView.swift
│  ├─ Pipeline/
│  │  ├─ AudioPipeline.swift      # receives buffers from extension
│  │  ├─ ASRStreamer.swift        # Speech / Deepgram wrapper
│  │  ├─ MTStreamer.swift         # Translation / DeepL / GPT wrapper
│  │  └─ CaptionAggregator.swift  # merges local+remote → lines
│  ├─ WebRTC/
│  │  ├─ RoomManager.swift        # create room, signaling
│  │  └─ PeerConnection.swift
│  └─ LiveActivity/
│     └─ CallTranslationActivity.swift
├─ BroadcastExtension/            # ReplayKit extension target
│  └─ SampleHandler.swift         # RPBroadcastSampleHandler → audio buffers → App group
├─ SignalingServer/              # tiny Node/Go WebRTC signaling relay
└─ Shared/
   └─ AppGroup+Buffers.swift      # shared via App Groups container
```

## Data Flow (one caption, end to end)
1. WhatsApp call active; user starts Broadcast from the app.
2. `SampleHandler` receives `CMSampleBuffer` (audio), tags it `local` (mic) or `remote` (app audio).
3. Buffers written to a shared App Group ring buffer; main app reads them.
4. `ASRStreamer` streams the buffer to Speech/Deepgram → partial text.
5. `MTStreamer` translates partial → target language.
6. `CaptionAggregator` emits a `CaptionLine { speaker, original, translated, ts }`.
7. Local UI: pushed to the Live Activity + PiP overlay.
8. Remote UI: burned into the outgoing WebRTC video track (or sent as a data-channel caption stream the browser renders).

## Performance Targets
- End-to-end latency (mouth → caption on screen): **< 1.5 s** (parity with EzDubs/iTour claims).
- ASR partial cadence: ~300 ms.
- MT per partial: < 400 ms.
- CPU: keep Broadcast Extension under its 50 MB memory cap (Forasoft). Do MT in the main app, not the extension.

## Open Questions / Decisions
1. **Overlay path:** Live Activity vs PiP vs burned-in-only — needs a prototype to see which feels closest to iTour's desktop overlay.
2. **ASR provider default:** on-device Speech (free, private) vs Deepgram (fast, more languages). Plan: default on-device, allow cloud toggle.
3. **Remote-party audio capture reliability:** confirm Broadcast Extension captures WhatsApp's speaker output reliably across iOS versions. If not, fall back to Approach C (browser-join for the friend, like iTour).
4. **Monetization:** one-time (iTour style, "lifetime free translation") vs subscription (AI Phone $6.99/wk). TBD.

## Deliverables for v1
- Working iOS app + Broadcast Extension that captions a live WhatsApp video call in 2 languages.
- Friend joins via browser link and sees the same captions.
- Live Activity rolling captions on the local device.
- Saved transcript after the call ends.
- Privacy policy + App Store submission materials.

## References
- iTour Chat Translation PC: https://www.itourtranslator.com/pages/itour-chat-translation-pc
- iTour cross-app flow: https://www.itourtranslator.com/blogs/news/cross-app-voice-video-translation-made-easy
- Apple ReplayKit: https://developer.apple.com/documentation/replaykit
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit
- Apple CallKit: https://developer.apple.com/documentation/callkit
- iOS screen sharing (Forasoft, 2026): https://www.forasoft.com/blog/article/how-to-implement-screen-sharing-in-ios-1193
- Competitor benchmarks: AI Phone, EzDubs, JotMe — https://www.aiphone.ai/blog/best-apps-for-real-time-video-call-translation-on-whatsapp/
- GitHub repo `javin23863/lang`: empty (README only, no code) — this spec is the greenfield plan.
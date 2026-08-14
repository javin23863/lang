# Store declarations source of truth

Use these answers when creating the Play Console and App Store Connect records.
They describe version 1.0 and must be reviewed again whenever SDKs or product
behavior change.

- No account required.
- No advertising, advertising identifier, or cross-app tracking.
- No analytics SDK.
- No transcript history or call recording.
- Camera and microphone access: user initiated, Foreground only, during a room.
- User-generated content: live speech and video are sent to the invited room;
  translated captions and optional synthesized audio are returned in real time.
- Cloud processing: Cloudflare carries room/signalling traffic; Modal performs
  speech recognition, translation, and optional voice synthesis.
- Retention: the product does not intentionally persist media or captions.
  Infrastructure security and error logs may be retained by the providers.
- Room control: the host can close a room; otherwise its bearer link expires
  after 24 hours.
- Safety/reporting: `/support` explains how to close a room and report abuse.
- App category: Social Networking (iOS) / Communication (Android).
- Intended audience: general adult communication; not directed to children.
- Encryption declaration: HTTPS/WebSocket TLS and platform cryptography only;
  review Apple export-compliance answers before submission.
- Content rating: camera/video communication and user-generated conversation;
  complete each store questionnaire truthfully rather than copying a number.

The app must not claim all text languages have verified live microphone or
translated-voice support. The in-app capability catalog is the source of truth.

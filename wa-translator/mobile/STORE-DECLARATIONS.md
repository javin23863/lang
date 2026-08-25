# Store declarations source of truth

Use these answers when creating the Play Console and App Store Connect records.
They describe version 1.0 and must be reviewed again whenever SDKs or product
behavior change.

- Account required to START a call: the person who creates a room signs in with
  Google, Apple, or Facebook. No account is required to JOIN one — an invited
  participant opens the link and talks, with no sign-in and no account.
- iOS login release gate: do not submit an iOS build while Google or Facebook is
  offered but the production Apple provider is not fully configured and visible
  as an equivalent sign-in option. The Worker intentionally hides providers
  whose credentials are incomplete, so this must be checked against the live
  production account screen before TestFlight/App Store submission.
- App Store support-contact gate: the public `/support` page currently provides
  the product-support issue form but no dedicated public support email, phone,
  or legal contact address. Do not submit version 1.0 to App Review until the
  operator has created an appropriate support contact and added it to that page.
  Do not substitute a developer's personal email address from source-control
  metadata. The App Store support URL must remain the production `/support`
  page after the contact is added.
- No password is ever created, collected, or stored. Sign-in is delegated to the
  provider; the app receives an account identifier, an email address, and a
  display name, and stores no provider credential.
- Room capacity: exactly two participants total — one local participant and one
  remote participant. Version 1.0 has no group-room or multiparty-call mode.
- Data collected: email address, an account user ID, display name/sign-in
  provider, and usage counts (call minutes, chat messages, translated-voice
  phrases). These are linked to the account and used for App Functionality only
  — never for tracking, advertising, or third-party sharing. Usage rows carry an
  opaque room reference, never a room link, and no message, caption, audio, or
  video content.
- Account deletion: available in the app (Delete account, on the main screen)
  and on the web at the same signed-in screen. Deletion removes the account
  profile, aggregate usage totals, and usage rows immediately.
- Monetization: version 1.0 has no purchase surface, stored credit balance,
  payment method, price, StoreKit product, or Google Play Billing product. The
  app may display recent usage as account activity, but it does not sell or
  unlock digital capacity.
- No advertising, advertising identifier, or cross-app tracking.
- No analytics SDK.
- No transcript history or call recording.
- Camera and microphone access: user initiated, foreground only, during a room.
- User-generated content: live speech/video and typed chat are sent to the
  invited room; translated captions and optional synthesized audio are returned
  in real time. Conversation content is not intentionally stored as history.
- Cloud processing: Cloudflare carries room/signalling/account traffic; Modal
  performs speech recognition, translation, and optional voice synthesis.
- Retention: the account profile (email, derived user ID, display name, provider)
  and aggregate usage totals last until the account is deleted; usage rows keep
  90 days or 200 rows, whichever is smaller. The product does not intentionally
  persist media, captions, chat content, or translated voice as conversation
  history. A private abuse report keeps category, platform, time, and an opaque
  public room reference for up to 30 days. Its internal non-invite room routing
  ID and room-expiry value exist only while moderator closure can still work and
  are deleted when that room expires, no later than 24 hours after creation.
  Infrastructure security and error logs may be retained by the providers.
- Room control: the host can close a room; otherwise its bearer link expires
  after 24 hours.
- Safety/reporting: a live participant can submit one private category-only
  report and block the room on that device. No report accepts names, free text,
  room links, transcripts, audio, video, captions, chat text, or screenshots.
- App category: Social Networking (iOS) / Communication (Android).
- Intended audience: general adult communication; not directed to children.
- Encryption declaration: HTTPS/WebSocket TLS and platform cryptography only;
  review Apple export-compliance answers before submission.
- Content rating: camera/video communication and user-generated conversation;
  complete each store questionnaire truthfully rather than copying a number.

The app must not claim all text languages have verified live microphone or
translated-voice support. The in-app capability catalog is the source of truth.

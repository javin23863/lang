# Store declarations source of truth

Use these answers when creating the Play Console and App Store Connect records.
They describe version 1.0 and must be reviewed again whenever SDKs or product
behavior change. Current platform-policy rationale is pinned separately in
`STORE-PRIVACY-SOURCES.md` and must be rechecked before a later submission.

- Account required to START a call: the person who creates a room signs in with
  one of the OAuth providers enabled for that release. The source supports Google
  and Apple plus optional Facebook; `/api/me` shows only fully configured
  providers, so store/reviewer instructions must match the live production list.
  No account is required to JOIN one — an invited participant opens the link and
  talks, with no sign-in and no account.
- Private-invite interaction model: version 1.0 has no public posting, public
  profile or user directory, people search, discovery feed, follower graph,
  random matching, stranger pairing, or open-room browsing. Communication exists
  only inside a private signed room invitation created by a signed-in host. The
  room is limited to exactly two participants and expires no later than 24 hours.
- Terms gate: first-time room entry uses an unchecked affirmative Terms checkbox.
  Only a prior acceptance of the exact current Terms version may restore that
  checkbox; acceptance of an older Terms version does not carry forward.
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
- Apple App Privacy classification: retained account name, email, user ID, and
  usage data are linked and used for App Functionality. The retained fixed-choice
  abuse-report category is unlinked `Other User Content`. The SHA-256-derived
  network-source identity used only to route a bounded abuse-quota counter is
  conservatively declared as unlinked `Other Data Types`. Live microphone audio
  and typed chat that are discarded after servicing the real-time request are not
  labeled as Apple collection merely because they cross the network.
- Google Play Data Safety classification: account name, email, and user ID are
  collected for Account management/App functionality; usage counts are collected
  as App interactions for App functionality; the fixed-choice abuse-report
  category is collected as Other user-generated content for safety functionality.
  `Voice or sound recordings` sent for speech recognition/translation and `Other
  in-app messages` sent through room chat are included in the form response and
  marked as processed ephemerally for App functionality. The SHA-256-derived
  source-IP quota identity is conservatively `Device or other IDs`: collected,
  not shared, required for abuse prevention, not ephemeral, and used for `Fraud
  prevention, security, and compliance`. Natural WebRTC camera/video and natural
  call audio remain end-to-end encrypted between participants, including through
  TURN relay, and are not readable by the developer or relay intermediary.
  Treat Cloudflare/Modal transfers as service-provider processing only if the
  actual production contractual role still satisfies Google's service-provider
  exception when the console form is completed.
- Authentication/security metadata: when a user logs out, the service stores
  only a one-way SHA-256 digest of that specific session token plus its original
  expiry so replay of a copied credential is rejected. The raw token is not
  stored in the revocation record. The digest is removed at token expiry (no
  later than 30 days from sign-in) or immediately when the account is deleted.
- Abuse-prevention network metadata: Cloudflare supplies the request source IP at
  the edge. The Worker hashes it with SHA-256 before quota routing and uses the
  digest only to select a per-action abuse-control object; the quota record itself
  contains only a window start and count and is deleted automatically at the end
  of its bounded window, never later than 24 hours. The quota identity is not
  joined to the signed-in account and is not used for advertising or tracking.
- Account deletion: available in the app (Delete account, on the main screen)
  and on the web at the same signed-in screen. Deletion removes the account
  profile, aggregate usage totals, usage rows, and logout-revocation markers
  immediately.
- Google Play external deletion URL: use the production URL ending in
  `/delete-account.html`. That page is publicly reachable without the mobile
  app, identifies Lingua Relay, explains deletion/retention, and directs the
  user to the browser account controls. Do not enter a generic support URL or
  temporary development hostname in the Play Console field.
- Monetization: version 1.0 has no purchase surface, stored credit balance,
  payment method, price, StoreKit product, or Google Play Billing product. The
  app may display recent usage as account activity, but it does not sell or
  unlock digital capacity.
- No advertising, advertising identifier, or cross-app tracking.
- No analytics SDK.
- No transcript history or call recording.
- Camera and microphone access: user initiated, foreground only, during a room.
- User-generated content: live speech/video and typed chat are sent only to the
  invited private room; translated captions and optional synthesized audio are
  returned in real time. Conversation content is not intentionally stored as
  history and is not published to a feed or made discoverable to other users.
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
  Abuse-quota counters keep only a window start/count in an object selected by a
  SHA-256-derived source-IP identity and are deleted at the quota-window end,
  never later than 24 hours. Infrastructure security and error logs may be
  retained by the providers.
- Room control: the host can close a room; otherwise its bearer link expires
  after 24 hours.
- Safety/reporting: a live participant can submit a private category-only report.
  No report accepts names, free text, room links, transcripts, audio, video,
  captions, chat text, or screenshots. In the installed app, once the report is
  durably accepted, the backend immediately invalidates that private room so the
  invitation cannot continue or be re-entered; the reporting client also leaves
  and locally blocks the room. If immediate server closure is temporarily
  unavailable after the durable report write, the report remains in the private
  moderator queue and the reporting client still leaves/blocks locally. Because
  version 1.0 has no persistent guest identity, cross-room messaging graph,
  discovery, or matching, that private room is the complete service relationship
  between the two participants.
- App category: Social Networking (iOS) / Communication (Android).
- Intended audience: general adult communication; not directed to children.
- Encryption declaration: HTTPS/WebSocket TLS and platform cryptography only;
  review Apple export-compliance answers before submission.
- Content rating: camera/video communication and user-generated conversation;
  complete each store questionnaire truthfully rather than copying a number.

The app must not claim all text languages have verified live microphone or
translated-voice support. The in-app capability catalog is the source of truth.

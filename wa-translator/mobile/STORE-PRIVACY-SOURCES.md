# Store privacy classification sources

Verified against primary platform guidance on **2026-08-26**. Re-check these pages before submitting a later release because store questionnaires and definitions can change independently of application source.

## Apple App Privacy

- App Privacy Details: https://developer.apple.com/app-store/app-privacy-details/
- App Store Connect App Privacy reference: https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy/
- Privacy manifest collected-data keys: https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes

Current classification rules used by Lingua Relay:

- Apple defines collection as transmitting data off device in a way that lets the developer or a third-party partner access it for longer than necessary to service the transmitted request in real time. Apple also says data sent to a server and immediately discarded after servicing the request does not need to be disclosed in App Store Connect. Live microphone/chat content that is discarded after servicing the request is therefore not labeled as collected merely because it crosses the network for the feature.
- Each installation keeps a random 128-bit pseudonymous participant-safety ID and a bounded list of safety IDs the user has blocked. The device sends both only when joining a room. The room service keeps them only with the live WebSocket attachment for admission/block enforcement and does not persist them in a profile, report, usage row, analytics record, or block-history database. Under Apple's real-time-request definition, this server handling is not labeled as collected. The peer receives only that installation's safety ID, never its local blocked-ID list. Re-check this behavior and Apple's live wording in App Store Connect before submission.
- Apple specifically says a stored IP address must be declared according to how it is used, such as a device identifier or diagnostics. Lingua Relay does not retain the raw source IP in application storage, but it does use a SHA-256-derived network-source identity to route a bounded abuse-quota counter. The app therefore conservatively declares `Other Data Types`, unlinked, for App Functionality.
- The retained fixed-choice abuse-report category is represented as unlinked `Other User Content`.
- Retained account name, email, user ID, and aggregate/recent usage are linked to the account and used for App Functionality only.

## Google Play Data Safety

- Data Safety form guidance: https://support.google.com/googleplay/android-developer/answer/10787469
- User Data policy: https://support.google.com/googleplay/android-developer/answer/10144311

Current classification rules used by Lingua Relay:

- Google defines collection as transmitting user data off device. Data used only in memory and retained no longer than necessary to service the specific request in real time must still be included in the form response, but can be marked as processed ephemerally.
- Google defines `Device or other IDs` as identifiers related to an individual device, browser, or app and explicitly says pseudonymous data must be disclosed. Lingua Relay therefore includes the random installation-scoped participant-safety ID and the bounded blocked-safety-ID list under `Device or other IDs` in the form response: collected, not shared with service-provider infrastructure as a third party, required for the room safety function, processed ephemerally off-device, and used for `Fraud prevention, security, and compliance` plus App functionality where the console allows both purposes. Only a peer's own safety ID is relayed to the other room participant; the user's local block list is never relayed to that peer. Confirm the final Play Console sharing interpretation against the then-current questionnaire before submission.
- The SHA-256-derived source-IP quota identity is also treated conservatively as `Device or other IDs`, collected, not shared, required for abuse prevention, not ephemeral, with purpose `Fraud prevention, security, and compliance`.
- Microphone speech sent for recognition/translation is `Voice or sound recordings`, processed ephemerally for App functionality.
- Typed room chat is `Other in-app messages`, processed ephemerally for App functionality.
- Natural WebRTC camera/video and natural call audio are end-to-end encrypted between participants, including when relayed by TURN, and are not readable by the developer or relay intermediary; they are therefore outside Google Play collection under the end-to-end-encryption exception. The microphone stream separately sent to speech recognition remains declared as ephemeral audio as above.
- Transfers to infrastructure acting solely as a service provider under the developer's instructions are not automatically treated as third-party sharing. Confirm the actual production Cloudflare/Modal contractual role before selecting the final console answer.

These notes are submission inputs, not proof that any App Store Connect or Play Console questionnaire has been completed.

# Store privacy classification sources

Verified against primary platform guidance on **2026-08-26**. Re-check these pages before submitting a later release because store questionnaires and definitions can change independently of application source.

## Apple App Privacy

- App Privacy Details: https://developer.apple.com/app-store/app-privacy-details/
- App Store Connect App Privacy reference: https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy/
- Privacy manifest collected-data keys: https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes

Current classification rules used by Lingua Relay:

- Apple defines collection as transmitting data off device and keeping it in readable form longer than necessary to service the real-time request. Live microphone/chat content that is discarded after servicing the request is therefore not labeled as collected merely because it crosses the network for the feature.
- Apple specifically says a stored IP address must be declared according to how it is used, such as a device identifier or diagnostics. Lingua Relay does not retain the raw source IP in application storage, but it does use a SHA-256-derived network-source identity to route a bounded abuse-quota counter. The app therefore conservatively declares `Other Data Types`, unlinked, for App Functionality.
- The retained fixed-choice abuse-report category is represented as unlinked `Other User Content`.
- Retained account name, email, user ID, and aggregate/recent usage are linked to the account and used for App Functionality only.

## Google Play Data Safety

- Data Safety form guidance: https://support.google.com/googleplay/android-developer/answer/10787469
- User Data policy: https://support.google.com/googleplay/android-developer/answer/10144311

Current classification rules used by Lingua Relay:

- Google defines collection as transmitting user data off device. Data used only in memory and retained no longer than necessary to service the specific request in real time must still be included in the form response, but can be marked as processed ephemerally.
- Pseudonymous data must still be disclosed. IP-address handling is classified by its actual use. Lingua Relay therefore treats the SHA-256-derived source-IP quota identity conservatively as `Device or other IDs`, collected, not shared, required for abuse prevention, not ephemeral, with purpose `Fraud prevention, security, and compliance`.
- Microphone speech sent for recognition/translation is `Voice or sound recordings`, processed ephemerally for App functionality.
- Typed room chat is `Other in-app messages`, processed ephemerally for App functionality.
- Natural WebRTC camera/video and natural call audio are end-to-end encrypted between participants, including when relayed by TURN, and are not readable by the developer or relay intermediary; they are therefore outside Google Play collection under the end-to-end-encryption exception. The microphone stream separately sent to speech recognition remains declared as ephemeral audio as above.
- Transfers to infrastructure acting solely as a service provider under the developer's instructions are not automatically treated as third-party sharing. Confirm the actual production Cloudflare/Modal contractual role before selecting the final console answer.

These notes are submission inputs, not proof that any App Store Connect or Play Console questionnaire has been completed.

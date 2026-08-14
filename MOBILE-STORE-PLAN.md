# Mobile store launch plan

> STATUS 2026-08-14: implementation wave active on `feat/mobile-store-shell`
> from `origin/main@11ce23129c9caec63079448370393ed1cf27a4db`.

## Adversarial grade of the previous plan

**42/100.** It was a policy checklist, not a build plan. It did not select a
native architecture, define installed-client version compatibility, replace
browser-only secret storage, produce signed build paths, or make the current
four-stream global compute ceiling a launch gate. It also implied that paying
store fees was the only operator action, omitting identity verification, legal
agreements, signing ownership, and store review.

## Release product

The first store release is a free, accountless, foreground-call application
named **Lingua Relay** with bundle/application ID
`com.javin23863.linguarelay`. It bundles the existing room interface inside a
Capacitor 8 native shell while keeping Cloudflare room/signalling and Modal
translation/TTS remote. WhatsApp carries only the invitation link. Opening a
signed room link launches the installed app or falls back to the public web
room.

No account, transcript history, advertising SDK, analytics SDK, subscription,
background camera, or push notification exists in this release. These are
deliberate privacy and cost ceilings, not incomplete scaffolding.

## Public seams and acceptance rows

| ID | Acceptance | Receipt |
|---|---|---|
| M1 | Android and iOS projects boot bundled files, never a remote website shell. | Native project configuration plus offline boot contract |
| M2 | A signed `/room/<token>` link enters the same room in the installed app; invalid hosts and malformed tokens fail closed. | Deep-link tests plus association endpoints |
| M3 | Camera and microphone are requested only after Start; deny/revoke paths remain usable and calls stop or reconnect cleanly across lifecycle changes. | Platform manifests plus native/browser lifecycle tests |
| M4 | Host-control bearer state uses Keychain/Android encrypted storage; locale/voice preferences may remain ordinary local preferences. | Secure-storage adapter test |
| M5 | Create, status, close, TURN, TTS, capabilities, and WebSocket traffic use a versioned mobile compatibility contract without weakening signed-room validation. | Worker mobile contract and regression suites |
| M6 | Privacy, terms, support, report/block guidance, retention, and provider disclosures are public and available inside the app. | Public endpoint tests and store declaration sources |
| M7 | Android targets API 36 and produces a release AAB. iOS targets the iOS 26 SDK and has a reproducible macOS archive/export workflow. | Clean build artifacts or an explicit signing-only hold |
| M8 | Store assets and metadata are source-controlled and match the product: free, accountless, no transcript history, foreground call only. | Metadata validation and screenshots |
| M9 | Existing web rooms, host control, captions, voice safety, and translation gates remain green. | Existing full suites |
| M10 | Public launch is blocked until relay-only TURN, capacity admission, and real Android-to-iPhone calls pass. | Physical-device launch checklist; no automated substitute |

## Implementation order

1. Add the Worker mobile compatibility and association seam.
2. Add one shared runtime module so browser and native callers differ only at
   the origin/storage/share/deep-link adapters.
3. Generate the Capacitor module and native projects from the shared web source.
4. Add platform permissions, secure storage, associated links, privacy files,
   and lifecycle behavior.
5. Add credential-free CI checks and credential-gated store build workflows.
6. Produce policy pages, store metadata, screenshots, review instructions, and
   the operator handoff.
7. Run plan-warden, regression, security, build, and physical-device gates.

## Operator-only actions after implementation

The operator must still pay and verify the Apple Developer and Google Play
accounts, accept their legal agreements, reserve the final store records,
provide the Apple Team ID and Play signing-certificate fingerprint, supply
signing credentials to repository secrets, complete any required Play closed
test, and submit for review. Store approval cannot be automated or guaranteed.

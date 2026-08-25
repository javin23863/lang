# Mobile store reuse sources — historical architecture research

Research date: 2026-08-14.

> **Scope note:** this file records dependency/tooling research, not the current
> product contract. Product-scope conclusions from the original research—most
> notably an accountless launch—are superseded by
> [`RELEASE-1.0.md`](RELEASE-1.0.md). Version 1.0 is exactly two joined
> participants; hosts authenticate to create rooms; guests join invitation links
> without accounts; and the release is non-monetized.

## Recommendation that still governs the build

Use **Capacitor 8**, not a native UI-framework rewrite. Bundle the existing web
assets inside generated Android and iOS projects, keep native projects under
source control, and add only the platform seams the product actually needs:
lifecycle/deep links, system sharing, secure storage, status-bar/splash behavior,
permissions, signing, and store packaging.

Cloudflare remains the control plane and Modal remains remote speech/translation
compute. App Links/Universal Links and platform privacy/signing files are direct
native configuration, not another hosted-link SDK.

This remains the lowest-complexity path because the application already has a
working browser/WebRTC interface and needs a small native shell rather than a
second UI implementation.

## Reused components

### Capacitor core and official plugins

- Project: <https://github.com/ionic-team/capacitor>
- Official plugins: <https://github.com/ionic-team/capacitor-plugins>
- Asset generator: <https://github.com/ionic-team/capacitor-assets>
- Documentation: <https://capacitorjs.com/docs/getting-started>

Reuse:

- generated Android/iOS projects and `webDir` syncing;
- `@capacitor/app` for cold/warm links and lifecycle events;
- `@capacitor/share` for the system share sheet;
- official status-bar/splash behavior;
- pinned `@capacitor/assets` as a development-time asset generator.

Do not add Ionic Framework simply because Capacitor is used; the product does
not need a UI-framework migration.

### fastlane and native build tools

- fastlane: <https://github.com/fastlane/fastlane>
- Android release guide:
  <https://docs.fastlane.tools/getting-started/android/release-deployment/>
- iOS release guide:
  <https://docs.fastlane.tools/getting-started/ios/appstore-deployment/>

Use the checked-in Gradle/Xcode projects for real builds and fastlane for
repeatable beta/store upload and metadata. Keep release automation narrow:
Android AAB → Play Internal, iOS archive → TestFlight. Production rollout remains
an explicit owner/store-console decision.

CI cannot pay accounts, complete identity verification, accept agreements,
provide reviewer access, satisfy physical-device acceptance, or guarantee store
approval.

### Secure storage

- Plugin: <https://github.com/aparajita/capacitor-secure-storage>

This is the deliberately small third-party runtime seam. Current native code
uses it behind one adapter for security-sensitive device state such as the
native session/proof and host-control bearer. iOS uses Keychain and Android uses
Keystore-backed encryption. Ordinary locale/interface preferences do not need
secret storage.

Keep the plugin pinned and replace the adapter with small native implementations
if it stops tracking the active Capacitor major; do not spread storage-library
calls throughout product code.

## Adoption matrix

| Need | Decision |
|---|---|
| Android + iOS shell | Capacitor 8; bundled local web assets, no remote-site wrapper |
| Lifecycle/deep links | `@capacitor/app`; validate exact hosts/schemes/tokens before navigation |
| Sharing | `@capacitor/share`; no WhatsApp SDK |
| Icons/splash | pinned `@capacitor/assets` development tool |
| Android build | Gradle wrapper and release AAB |
| iOS build | generated Xcode project on macOS |
| Store upload | fastlane, protected/manual beta workflows |
| Android App Links | manifest + Worker `assetlinks.json` |
| iOS Universal Links | Associated Domains + Worker AASA |
| OAuth return | app-only custom scheme with bound one-time handoff |
| Privacy manifest | direct iOS target resource, reviewed with dependency changes |
| Secret device state | secure-storage adapter only |
| Final verification | signed physical Android/iPhone acceptance; no synthetic substitute |

## Explicitly rejected for Version 1.0

- **Flutter / React Native / Expo:** unnecessary rewrite of the existing web and
  WebRTC product.
- **Bubblewrap/TWA:** Android-only hosted-PWA shape, not the shared Android/iOS
  native seam required here.
- **PWABuilder as the primary pipeline:** packaging does not replace the product's
  explicit secure-storage, lifecycle, media-permission, OAuth-return, and
  cross-platform link requirements.
- **Cordova:** a second hybrid runtime provides no value beside Capacitor.
- **Branch/Firebase Dynamic Links/link SaaS:** direct platform associations are
  sufficient.
- **Managed signing/build services by default:** native Gradle/Xcode + protected
  repository workflows are adequate for the first release. Revisit only if
  measured maintenance burden justifies another privileged service.
- **Analytics/advertising/background-call/push/transcript-history SDK expansion:**
  none belongs in the Version 1.0 release contract.
- **Group/multiparty infrastructure:** Version 1.0 is explicitly two people;
  do not use historical four-person experiments as a reason to add N-peer UI or
  group signalling.

## Current adoption order

The dependency research phase is complete. Current work follows the release
contract/checklist instead:

1. Keep source/security/privacy/store behavior aligned with `RELEASE-1.0.md`.
2. Keep browser and Capacitor generation paths equivalent.
3. Run the complete exact-head credential-free matrix only after development is
   declared complete.
4. Configure final origin, OAuth/signing/store ownership and run signed Play
   Internal/TestFlight workflows.
5. Perform representative physical Android/iPhone acceptance before public
   submission.

For current status use `wa-translator/mobile/LAUNCH-CHECKLIST.md`, not this dated
research note.

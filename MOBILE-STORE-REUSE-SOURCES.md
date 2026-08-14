# Mobile store reuse sources

Research date: 2026-08-14. Scope: the shortest maintained path from the
existing vanilla HTML/CSS/JavaScript room to Android and iOS store builds.

## Recommendation

Use **Capacitor 8**, not a UI-framework rewrite. Bundle the existing web assets
inside its generated Android and iOS projects, then add only the official App
and Share plugins plus one secure-storage plugin. Build with the native Gradle
and Xcode projects Capacitor generates; use **fastlane** only for repeatable
metadata, beta upload, and store upload. App Links, Universal Links, and the
iOS privacy manifest are platform files, so implement them directly rather
than adding another service or SDK.

This is the lowest-complexity route that still produces real native binaries,
keeps the current web product, and permits native lifecycle, sharing, secure
storage, camera, and microphone behavior.

## Top three reuse choices

### 1. Capacitor core, official plugins, and asset generator

- Repositories: [ionic-team/capacitor](https://github.com/ionic-team/capacitor),
  [ionic-team/capacitor-plugins](https://github.com/ionic-team/capacitor-plugins),
  [ionic-team/capacitor-assets](https://github.com/ionic-team/capacitor-assets).
- Why: Capacitor is explicitly designed to drop into an existing JavaScript
  web project; `npx cap add android`, `npx cap add ios`, and `npx cap sync`
  generate and update ordinary native projects. The official App plugin
  supplies lifecycle/deep-link events and the Share plugin opens the native
  share sheet. `@capacitor/assets` generates Android/iOS icons and splash
  resources from one source image. Sources:
  [installation](https://capacitorjs.com/docs/getting-started),
  [App API](https://capacitorjs.com/docs/apis/app),
  [Share API](https://capacitorjs.com/docs/apis/share),
  [asset generator](https://github.com/ionic-team/capacitor-assets).
- Maintenance/adoption: MIT; about 15.9k GitHub stars; GitHub showed Capacitor
  8.4.0 released 2026-06-02 during this review. The docs are on the v8 line.
  The separate asset generator is also MIT and official, but its last tagged
  release shown by GitHub was 3.0.5 in 2024; it is a one-shot build tool, not a
  runtime dependency.
- Reuse exactly: generated `android/` and `ios/` projects, `webDir` syncing,
  `appUrlOpen`/`getLaunchUrl`, app-state events, `Share.share`, and generated
  store icons/splash assets. Do not add Ionic Framework; Capacitor does not
  require it.
- Risk: pin one tested Capacitor 8 minor across core, platforms, and plugins.
  Do not float versions independently. A current Android 16 safe-area issue
  was reported against 8.4.1, which reinforces real-device acceptance rather
  than blind upgrades:
  [ionic-team/capacitor#8530](https://github.com/ionic-team/capacitor/issues/8530).

### 2. fastlane, driven by a small GitHub Actions workflow

- Repository: [fastlane/fastlane](https://github.com/fastlane/fastlane).
- Why: one MIT tool covers both stores. `supply` uploads Android AABs,
  localized metadata, and screenshots; `build_app`, `pilot`, and `deliver`
  build/upload TestFlight and App Store artifacts and metadata. Sources:
  [Google Play deployment](https://docs.fastlane.tools/getting-started/android/release-deployment/),
  [supply](https://docs.fastlane.tools/actions/upload_to_play_store/),
  [App Store deployment](https://docs.fastlane.tools/getting-started/ios/appstore-deployment/),
  [deliver](https://docs.fastlane.tools/actions/appstore/).
- Maintenance/adoption: MIT; about 41.6k stars; GitHub showed 2.235.0 released
  2026-05-26. Pin it in `Gemfile.lock`; its own Android setup guide recommends
  a Gemfile:
  [fastlane Android setup](https://docs.fastlane.tools/getting-started/android/setup/).
- Reuse exactly: two lanes only: Android `bundleRelease` plus
  `upload_to_play_store`, and iOS `build_app` plus `upload_to_testflight` or
  `upload_to_app_store`. Store listing text and screenshots in fastlane's
  conventional metadata directories.
- GitHub Actions building blocks: use
  [actions/setup-java](https://github.com/actions/setup-java),
  [gradle/actions](https://github.com/gradle/actions), and
  [ruby/setup-ruby](https://github.com/ruby/setup-ruby), then run the checked-in
  Gradle wrapper and `bundle exec fastlane`. Avoid a separate marketplace
  action for every store step.
- iOS signing option after the Apple account exists: the MIT
  [Apple-Actions/download-provisioning-profiles](https://github.com/Apple-Actions/download-provisioning-profiles)
  suite includes a setup script that can create/reuse the bundle ID,
  distribution certificate, provisioning profile, `ExportOptions.plist`, and
  GitHub secrets; pair it with
  [import-codesign-certs](https://github.com/Apple-Actions/import-codesign-certs).
  Treat this as community code despite the organization name: review and pin
  it before allowing its bootstrap script to mutate the Apple account or
  repository secrets. Do not add fastlane `match` and a second private signing
  repository for a one-person v1; add it only when multiple maintainers need
  shared signing.
- Risk: CI can prepare and upload a signed build, but it cannot pay accounts,
  accept legal agreements, complete identity checks, satisfy the Play testing
  period, or guarantee review approval.

### 3. One secure-storage plugin for the host-control bearer

- Repository:
  [aparajita/capacitor-secure-storage](https://github.com/aparajita/capacitor-secure-storage).
- Why: it is the only proposed third-party runtime dependency. Version 8.0.0
  targets Capacitor 8, uses the iOS Keychain, and encrypts Android values with
  an AES-GCM key held by Android Keystore. It is MIT and provides both
  CocoaPods/SPM and Android examples. The repository showed about 168 stars
  and only a small issue queue during this review.
- Reuse exactly: a tiny adapter that stores, reads, and deletes only the
  short-lived host-control bearer. Disable iCloud Keychain synchronization.
  Keep locale and voice preferences in ordinary preferences; never send room
  secrets through the plugin's unencrypted web fallback.
- Risk: this is a smaller, effectively single-maintainer project. Pin 8.0.0,
  keep all calls behind one local adapter, and run its Android/iOS build check
  on upgrades. If it stops tracking Capacitor, replace that adapter with two
  small native Keychain/Keystore implementations rather than spreading a new
  storage library through the app.

## Adoption matrix

| Need | Reuse | Exact application | Decision / risk |
|---|---|---|---|
| Native Android + iOS shell | Capacitor 8 | Generate native projects; point `webDir` at the bundled room build; run `cap sync` | Adopt. No Flutter, React Native, or Ionic UI rewrite. |
| App lifecycle and incoming room links | `@capacitor/app` | Handle cold `getLaunchUrl`, warm `appUrlOpen`, and foreground/background events | Adopt official plugin. Validate HTTPS host and `/room/<signed-token>` before navigation. |
| WhatsApp/system sharing | `@capacitor/share` | Share the existing signed HTTPS room URL through the OS sheet | Adopt official plugin. Do not add a WhatsApp SDK. |
| Icons and splash assets | `@capacitor/assets` | Generate both platform resource sets from one reviewed source image | Adopt as pinned dev tool; inspect generated assets. |
| Android build | Gradle wrapper + `actions/setup-java` | Run tests and `bundleRelease`; retain AAB artifact | Adopt. No third-party AAB builder action. |
| iOS archive | Generated Xcode project + fastlane `build_app` on macOS | Archive/export using checked-in `ExportOptions.plist` | Adopt after Apple Team ID and signing exist. macOS/Xcode remains unavoidable. |
| iOS signing bootstrap | Apple-Actions setup/import/profile actions | Create/import distribution certificate and install App Store profile from secrets | Conditional adopt. Community dependency with privileged access; pin and review. |
| Store metadata and upload | fastlane `supply` / `deliver` / `pilot` | Source-control listing text and screenshots; upload to closed testing/TestFlight before production | Adopt. Keep production release manual/approved. |
| Screenshot capture | Existing deterministic test/demo room; fastlane only for upload initially | Capture the minimum accepted device sizes, then store and upload them through fastlane | Defer `snapshot`/`screengrab` automation until repeated localization makes its UI-test scaffolding cheaper than manual capture. [fastlane screenshot docs](https://docs.fastlane.tools/getting-started/ios/screenshots/) |
| Android App Links | Platform manifest + Worker-hosted `/.well-known/assetlinks.json` | Declare `autoVerify`; bind package and final Play signing fingerprint | Direct implementation. No Branch, Firebase Dynamic Links, or link SaaS. [Android docs](https://developer.android.com/training/app-links/add-applinks) |
| iOS Universal Links | Associated Domains entitlement + Worker-hosted `/.well-known/apple-app-site-association` | Bind Team ID/bundle ID and room path | Direct implementation. Capacitor documents the complete two-platform flow. [Capacitor deep-link guide](https://capacitorjs.com/docs/guides/deep-links) |
| iOS privacy manifest | `PrivacyInfo.xcprivacy` in the app target | Declare actual collected data and required-reason APIs used by chosen plugins | Direct implementation, reviewed with each dependency change. [Apple privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files), [Capacitor guide](https://capacitorjs.com/docs/ios/privacy-manifest) |
| Host bearer storage | `@aparajita/capacitor-secure-storage` | Keychain/Keystore only in native builds | Adopt behind one adapter; disable iCloud sync and pin version. |

## Explicitly rejected for v1

- **Flutter, React Native, or Expo:** they require rewriting an already working
  web UI and its browser/WebRTC integration. They solve a problem this product
  does not have.
- **Bubblewrap/TWA:**
  [GoogleChromeLabs/bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
  launches a hosted PWA in an Android Trusted Web Activity and is Android-only;
  it does not provide the one shared Android/iOS native seam required here.
- **PWABuilder as the primary pipeline:**
  [pwa-builder/PWABuilder](https://github.com/pwa-builder/PWABuilder) is useful
  for generic PWA packaging, but the product still needs explicit native
  lifecycle, secure storage, media permissions, and cross-platform deep links.
  Capacitor exposes those seams without handing the release layout to another
  generator.
- **Cordova:** Capacitor already supports the existing web code while treating
  the native projects as source artifacts and is the actively documented Ionic
  path. A second hybrid runtime adds no value.
- **Ionic Appflow, Bitrise, Codemagic, Branch, Firebase Dynamic Links, and
  hosted signing services:** none are needed to reach the first stores. Revisit
  managed CI only if maintaining macOS/Android runners becomes a measured
  burden.
- **Accounts, subscriptions, push notifications, analytics SDKs, background
  calling, and transcript history:** none are required for the free,
  accountless foreground-call launch, and each adds policy, security, cost, or
  review work.

## Minimal adoption order

1. Add Capacitor 8 and generate the two native projects from the current web
   build.
2. Add only App, Share, and the secure-storage adapter; configure native media
   permissions and foreground lifecycle behavior.
3. Host and verify the two association files, then test a real WhatsApp room
   link on Android and iPhone.
4. Add credential-free CI native builds. After paid developer accounts exist,
   add signing secrets and fastlane beta lanes.
5. Put listing metadata and accepted screenshots under version control; upload
   to Play closed testing and TestFlight. Keep the production-release button a
   human approval.

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { MOBILE_AUTH_SCHEME, PUBLIC_ORIGIN } from "../src/runtime-core.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const PUBLIC_HOST = new URL(PUBLIC_ORIGIN).hostname;
const escapedHost = PUBLIC_HOST.replaceAll(".", "\\.");

test("Android declares foreground media, verified rooms, and app-scheme auth return", async () => {
  const manifest = await read("../android/app/src/main/AndroidManifest.xml");
  const filePaths = await read("../android/app/src/main/res/xml/file_paths.xml");
  const gradle = await read("../android/app/build.gradle");
  const variables = await read("../android/variables.gradle");

  for (const permission of ["android.permission.CAMERA", "android.permission.RECORD_AUDIO"]) {
    assert.match(manifest, new RegExp(`uses-permission android:name="${permission.replaceAll(".", "\\.")}"`));
  }
  assert.match(manifest, /uses-feature android:name="android\.hardware\.camera" android:required="false"/);
  assert.match(manifest, /uses-feature android:name="android\.hardware\.microphone" android:required="false"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:autoVerify="true"/);
  assert.match(manifest, /android:scheme="https"/);
  assert.match(manifest, new RegExp(`android:host="${escapedHost}"`),
               "Android verified links must match runtime PUBLIC_ORIGIN");
  assert.match(manifest, /android:pathPrefix="\/room\/"/);
  assert.match(manifest, new RegExp(`android:scheme="${MOBILE_AUTH_SCHEME.replaceAll(".", "\\.")}"`));
  assert.match(manifest, /android:host="auth"/);
  assert.doesNotMatch(manifest, /android:path="\/mobile-auth-complete"/);
  assert.match(variables, /compileSdkVersion = 36/);
  assert.match(variables, /targetSdkVersion = 36/);
  assert.match(gradle, /LINGUA_ANDROID_KEYSTORE/);
  assert.match(gradle, /LINGUA_ANDROID_VERSION_CODE/);
  assert.match(gradle, /LINGUA_ANDROID_VERSION_NAME/);
  assert.doesNotMatch(gradle, /storePassword\s+["'][^$]/);
  assert.match(filePaths, /<cache-path/);
  assert.doesNotMatch(filePaths, /<external-path/);
});

test("iOS declares foreground media, universal rooms, app-scheme auth, and privacy manifest", async () => {
  const info = await read("../ios/App/App/Info.plist");
  const entitlements = await read("../ios/App/App/App.entitlements");
  const privacy = await read("../ios/App/App/PrivacyInfo.xcprivacy");
  const project = await read("../ios/App/App.xcodeproj/project.pbxproj");
  const appDelegate = await read("../ios/App/App/AppDelegate.swift");

  assert.match(info, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(info, /<key>NSMicrophoneUsageDescription<\/key>/);
  assert.match(info, /<key>CFBundleURLTypes<\/key>/);
  assert.match(info, new RegExp(`<string>${MOBILE_AUTH_SCHEME.replaceAll(".", "\\.")}<\\/string>`));
  assert.doesNotMatch(info, /<key>UIBackgroundModes<\/key>/);
  assert.doesNotMatch(info, /NSAllowsArbitraryLoads/);
  assert.match(entitlements, new RegExp(`applinks:${escapedHost}`),
               "iOS associated domains must match runtime PUBLIC_ORIGIN");
  assert.match(privacy, /NSPrivacyTracking[\s\S]*<false\/>/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeOtherUserContent/);
  assert.match(privacy, /NSPrivacyCollectedDataTypePurposeAppFunctionality/);
  // Category-only abuse reports are not account-linked; account/profile and
  // aggregate usage entries are linked by definition.
  assert.match(
    privacy,
    /NSPrivacyCollectedDataTypeOtherUserContent<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<false\/>/
  );
  for (const type of [
    "Name", "EmailAddress", "UserID", "OtherUsageData",
  ]) {
    assert.match(
      privacy,
      new RegExp(`NSPrivacyCollectedDataType${type}[\\s\\S]*?NSPrivacyCollectedDataTypeLinked<\\/key>\\s*<true\\/>`),
      `${type} must reflect linked retained account data`,
    );
  }
  assert.doesNotMatch(privacy, /NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\/>/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.javin23863\.linguarelay;/);
  assert.match(project, /TARGETED_DEVICE_FAMILY = "1";/);
  assert.doesNotMatch(project, /TARGETED_DEVICE_FAMILY = "1,2";/);
  assert.match(project, /CODE_SIGN_IDENTITY = "Apple Distribution";/);
  assert.match(appDelegate, /AVAudioSession/);
  assert.match(appDelegate, /\.playAndRecord/);
  assert.match(appDelegate, /mode:\s*\.videoChat/);
  assert.match(appDelegate, /\.allowBluetoothHFP/);
  assert.match(appDelegate, /\.defaultToSpeaker/);
});

test("Capacitor sync derives native association hosts and verifies legal material", async () => {
  const script = await read("../scripts/sync-platform-origin.mjs");
  const packageJson = JSON.parse(await read("../package.json"));
  assert.match(script, /import \{ MOBILE_AUTH_SCHEME, PUBLIC_ORIGIN \} from "\.\.\/src\/runtime-core\.mjs"/);
  assert.match(script, /Android verified-link host/);
  assert.match(script, /iOS associated-domain host/);
  assert.match(script, /iOS auth-return URL scheme/);
  assert.equal(packageJson.scripts["sync:platform"], "node scripts/sync-platform-origin.mjs");
  assert.match(
    packageJson.scripts.sync,
    /cap sync && npm run sync:platform && node scripts\/verify-synced-notices\.mjs$/,
    "association generation and native notice verification must run after Capacitor modifies platform projects",
  );
});

test("store icon source and generated platform icons exist", async () => {
  const source = await stat(new URL("../assets/icon-1024.png", import.meta.url));
  const android = await stat(new URL("../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", import.meta.url));
  const ios = await stat(new URL("../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", import.meta.url));
  assert.ok(source.size > 10000);
  assert.ok(android.size > 1000);
  assert.ok(ios.size > 10000);
});

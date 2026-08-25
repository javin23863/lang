import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Android release config targets the current Play API floor", async () => {
  const gradle = await read("../android/variables.gradle");
  assert.match(gradle, /compileSdkVersion\s*=\s*36\b/);
  assert.match(gradle, /targetSdkVersion\s*=\s*36\b/);
});

test("Android AAB is inspected before CI artifact publication and Play upload", async () => {
  const gradle = await read("../android/build.gradle");
  const version = gradle.match(/com\.android\.tools\.build:gradle:(\d+)\.(\d+)\.(\d+)/);
  assert.ok(version, "Android Gradle Plugin version is explicit");
  const [, majorRaw, minorRaw, patchRaw] = version;
  const [major, minor, patch] = [majorRaw, minorRaw, patchRaw].map(Number);
  assert.ok(major > 8 || (major === 8 && (minor > 5 || (minor === 5 && patch >= 1))),
            "AGP must remain at least 8.5.1 for 16 KB zip alignment");

  const alignment = await read("../scripts/verify-android-16k.sh");
  assert.match(alignment, /PAGE_ALIGNMENT_16K/);
  assert.match(alignment, /readelf -lW/);
  assert.match(alignment, /alignment < 0x4000/);

  const verifier = await read("../scripts/verify-android-aab.sh");
  assert.match(verifier, /dump manifest/);
  assert.match(verifier, /com\.javin23863\.linguarelay/);
  assert.match(verifier, /android\.permission\.CAMERA/);
  assert.match(verifier, /android\.permission\.RECORD_AUDIO/);
  assert.match(verifier, /android:allowBackup=\"false\"/);
  assert.match(verifier, /android:usesCleartextTraffic=\"false\"/);
  assert.match(verifier, /base\/assets\/public\/room\.css/);
  assert.match(verifier, /base\/assets\/public\/room\.js/);
  assert.match(verifier, /verify-android-16k\.sh/);

  const workflow = await read("../../../.github/workflows/mobile-build.yml");
  assert.match(workflow, /name: Verify Android release artifact/);
  assert.match(workflow, /bash scripts\/verify-android-aab\.sh/);

  const fastfile = await read("../fastlane/Fastfile");
  const verifyAt = fastfile.indexOf("verify-android-aab.sh");
  const uploadAt = fastfile.indexOf("upload_to_play_store");
  assert.ok(verifyAt >= 0 && uploadAt > verifyAt,
            "signed Play uploads verify the exact AAB before upload");
});

test("iOS release metadata requires the 64-bit device architecture", async () => {
  const plist = await read("../ios/App/App/Info.plist");
  const capabilities = plist.match(
    /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>([\s\S]*?)<\/array>/
  );
  assert.ok(capabilities, "Info.plist declares required device capabilities");
  assert.match(capabilities[1], /<string>arm64<\/string>/);
  assert.doesNotMatch(capabilities[1], /<string>armv7<\/string>/);
});

test("iOS CI and TestFlight verify the packaged app before upload", async () => {
  const verifier = await read("../scripts/verify-ios-app.sh");
  assert.match(verifier, /Payload/,
               "the verifier can inspect the exact signed IPA payload");
  assert.match(verifier, /PlistBuddy/);
  assert.match(verifier, /lipo -archs/);
  assert.match(verifier, /PrivacyInfo\.xcprivacy/);
  assert.match(verifier, /room\.css/);
  assert.match(verifier, /room\.js/);
  assert.match(verifier, /0 \/ 2 people/);
  assert.match(verifier, /0 \/ 4 people/);
  assert.match(verifier, /BEGIN PRIVATE KEY/);

  const workflow = await read("../../../.github/workflows/mobile-build.yml");
  assert.match(workflow, /name: Verify iOS release artifact/);
  assert.match(workflow, /bash scripts\/verify-ios-app\.sh/);

  const fastfile = await read("../fastlane/Fastfile");
  assert.match(fastfile, /output_name:\s*"LinguaRelay\.ipa"/);
  const verifyAt = fastfile.indexOf("verify-ios-app.sh");
  const uploadAt = fastfile.indexOf("upload_to_testflight");
  assert.ok(verifyAt >= 0 && uploadAt > verifyAt,
            "signed TestFlight uploads verify the IPA before upload");
});

test("build and signed-beta workflows enforce current store SDK floors", async () => {
  for (const path of ["../../../.github/workflows/mobile-build.yml",
                      "../../../.github/workflows/mobile-beta.yml"]) {
    const workflow = await read(path);
    assert.match(workflow, /name: Verify Play target API/);
    assert.match(workflow, /compileSdkVersion\\s\*=\\s\*36/);
    assert.match(workflow, /targetSdkVersion\\s\*=\\s\*36/);
    assert.match(workflow, /runs-on: macos-26/);
    assert.match(workflow, /name: Verify App Store SDK floor/);
    assert.match(workflow, /xcodebuild -version/);
    assert.match(workflow, /xcrun --sdk iphoneos --show-sdk-version/);
    assert.match(workflow, /xcode_major.*-lt 26/);
    assert.match(workflow, /sdk_major.*-lt 26/);
  }
});

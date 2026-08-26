import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("credential-free native smoke boots and launches both installed apps", async () => {
  const [workflow, android, ios] = await Promise.all([
    read("../../../.github/workflows/mobile-native-smoke.yml"),
    read("../scripts/smoke-android-emulator.sh"),
    read("../scripts/smoke-ios-simulator.sh"),
  ]);

  assert.match(workflow, /name: Native mobile smoke/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s{2}(?:pull_request|push):/m,
    "native runtime acceptance stays manual until the required runners are available");
  assert.match(workflow, /android-emulator:/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /ios-simulator:/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /npm run sync/);
  assert.match(workflow, /bash scripts\/smoke-android-emulator\.sh/);
  assert.match(workflow, /bash scripts\/smoke-ios-simulator\.sh/);
  assert.match(workflow, /Verify exact smoke commit/);
  assert.match(workflow, /github\.sha/);
  assert.doesNotMatch(workflow, /environment:\s*(?:mobile-beta|cloudflare-production)/,
    "credential-free native smoke must not enter protected release environments");
  assert.doesNotMatch(workflow, /secrets\./,
    "credential-free native smoke must not require store or deployment secrets");

  for (const marker of [
    "Write Android native smoke receipt",
    "Write iOS native smoke receipt",
    '"schema":1',
    '"head":"%s"',
    '"result":"passed"',
    "lingua-relay-native-smoke-android",
    "lingua-relay-native-smoke-ios",
    "build/native-smoke/android.json",
    "build/native-smoke/ios.json",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "retention-days: 30",
  ]) assert.ok(workflow.includes(marker), `Native smoke evidence contract is missing ${marker}`);

  for (const marker of [
    'SYSTEM_IMAGE="system-images;android-36;google_apis;x86_64"',
    '"$EMULATOR" -avd "$AVD_NAME"',
    ':app:assembleDebugAndroidTest',
    'am start -W -n "$APP_ID/.MainActivity"',
    'pidof "$APP_ID"',
    ':app:connectedDebugAndroidTest',
  ]) assert.ok(android.includes(marker), `Android native smoke is missing ${marker}`);
  assert.match(android, /APP_ID="com\.javin23863\.linguarelay"/);
  assert.match(android, /sys\.boot_completed/);
  assert.match(android, /Android native smoke passed/);

  for (const marker of [
    "-sdk iphonesimulator",
    "generic/platform=iOS Simulator",
    'xcrun simctl bootstatus "$udid" -b',
    'xcrun simctl install "$udid" "$APP_PATH"',
    'xcrun simctl launch "$udid" "$APP_ID"',
    'kill -0 $app_pid',
  ]) assert.ok(ios.includes(marker), `iOS native smoke is missing ${marker}`);
  assert.match(ios, /APP_ID="com\.javin23863\.linguarelay"/);
  assert.match(ios, /Debug-iphonesimulator\/App\.app/);
  assert.match(ios, /iOS native smoke passed/);
});

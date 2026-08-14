import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("credential-free CI builds both native products", async () => {
  const workflow = await read("../../../.github/workflows/mobile-build.yml");
  assert.match(workflow, /gradlew :app:bundleRelease/);
  assert.match(workflow, /xcodebuild/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node|setup-java|upload-artifact)@v4/);
});

test("credential-gated Fastlane lanes stop at beta tracks", async () => {
  const fastfile = await read("../fastlane/Fastfile");
  const gemfile = await read("../Gemfile");
  const lockfile = await read("../Gemfile.lock");
  const workflow = await read("../../../.github/workflows/mobile-beta.yml");
  assert.match(gemfile, /gem "fastlane", "2\.238\.0"/);
  assert.match(gemfile, /gem "multi_json", "1\.21\.1"/);
  assert.match(lockfile, /fastlane \(= 2\.238\.0\)/);
  assert.match(lockfile, /multi_json \(= 1\.21\.1\)/);
  assert.match(fastfile, /track: "internal"/);
  assert.match(fastfile, /upload_to_testflight/);
  assert.doesNotMatch(fastfile, /track: "production"/);
  assert.doesNotMatch(fastfile, /upload_to_app_store/);
  for (const secret of [
    "LINGUA_ANDROID_KEYSTORE_B64", "GOOGLE_PLAY_JSON_KEY_B64",
    "APP_STORE_CONNECT_KEY_B64", "APPLE_TEAM_ID"
  ]) assert.match(workflow, new RegExp(secret));
});

test("store listing and operator declarations are source controlled", async () => {
  const android = await read("../fastlane/metadata/android/en-US/full_description.txt");
  const ios = await read("../fastlane/metadata/ios/en-US/description.txt");
  const declarations = await read("../STORE-DECLARATIONS.md");
  for (const text of [android, ios]) {
    assert.match(text, /live translated captions/i);
    assert.match(text, /camera and microphone/i);
    assert.doesNotMatch(text, /100 spoken languages|unlimited|guaranteed/i);
  }
  assert.match(declarations, /No account required/);
  assert.match(declarations, /No advertising/);
  assert.match(declarations, /No transcript history/);
  assert.match(declarations, /Foreground only/);
});

test("both stores have two accepted-size phone screenshots", async () => {
  for (const path of [
    "../fastlane/metadata/android/en-US/images/phoneScreenshots/01-dashboard.png",
    "../fastlane/metadata/android/en-US/images/phoneScreenshots/02-room.png",
    "../fastlane/screenshots/en-US/01-dashboard.png",
    "../fastlane/screenshots/en-US/02-room.png",
  ]) assert.ok((await stat(new URL(path, import.meta.url))).size > 50000, path);
});

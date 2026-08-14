import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("credential-free CI builds both native products", async () => {
  const workflow = await read("../../../.github/workflows/mobile-build.yml");
  assert.match(workflow, /gradlew :app:bundleRelease/);
  assert.match(workflow, /xcodebuild/);
  assert.match(workflow, /product-regression:/);
  assert.match(workflow, /working-directory: wa-translator\/cloudflare/);
  assert.match(workflow, /python -m pip install numpy==2\.4\.6 websockets==17\.0\.1/);
  assert.match(workflow, /python -m unittest[\s\S]*test_language_catalog\.py[\s\S]*test_cloud_client\.py[\s\S]*test_latency_acceptance\.py[\s\S]*test_live_bilingual_check\.py[\s\S]*test_multilingual_fixtures\.py/);
  assert.match(workflow, /\.github\/workflows\/mobile-beta\.yml/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /uses:\s+[^\n]+@(v\d+|main|master)\s*$/m);
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
  assert.match(workflow, /npm ci && npm run check && npm run sync/);
  assert.match(workflow, /bundle exec fastlane --version/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /LINGUA_ANDROID_VERSION_CODE=\$\{build_epoch\}/);
  assert.match(workflow, /LINGUA_ANDROID_VERSION_NAME=1\.0\.\$\{GITHUB_RUN_NUMBER\}\.\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.equal((workflow.match(/date -u \+%s/g) || []).length, 2);
  assert.match(workflow, /LINGUA_IOS_BUILD_NUMBER=\$\(date -u \+%s\)/);
  for (const job of ["android", "ios"]) {
    const section = workflow.split(`\n  ${job}:`)[1].split("\n  ")[0];
    assert.doesNotMatch(section.split("\n    steps:")[0], /\$\{\{ secrets\./);
  }
  assert.doesNotMatch(workflow, /uses:\s+[^\n]+@(v\d+|main|master)\s*$/m);
  assert.ok(workflow.indexOf("npm ci && npm run check && npm run sync")
    < workflow.indexOf("Materialize signing credentials"));
  assert.match(fastfile, /track: "internal"/);
  assert.match(fastfile, /release_status: "completed"/);
  assert.doesNotMatch(fastfile, /release_status: "draft"/);
  assert.match(fastfile, /upload_to_testflight/);
  assert.doesNotMatch(fastfile, /track: "production"/);
  assert.doesNotMatch(fastfile, /upload_to_app_store/);
  assert.doesNotMatch(fastfile, /\bcert\(/);
  assert.doesNotMatch(fastfile, /\bsigh\(/);
  assert.match(fastfile, /import_certificate/);
  assert.match(fastfile, /install_provisioning_profile/);
  for (const secret of [
    "LINGUA_ANDROID_KEYSTORE_B64", "GOOGLE_PLAY_JSON_KEY_B64",
    "APP_STORE_CONNECT_KEY_B64", "APPLE_TEAM_ID",
    "APPLE_DISTRIBUTION_P12_B64", "APPLE_PROVISIONING_PROFILE_B64",
    "APPLE_DISTRIBUTION_CERT_PASSWORD", "APPLE_PROVISIONING_PROFILE_NAME"
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

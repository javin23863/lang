import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  APP_ID, MOBILE_PROTOCOL, PLAY_VERSION_CODE_MAX, PUBLIC_ORIGIN, normalizeFingerprint,
  releaseBuildNumber, validateAndroidAssociation, validateAppleAssociation,
  validateBootstrap, validateProviderSnapshot,
} from "../scripts/store-preflight.mjs";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

async function pngInfo(path) {
  const data = await readFile(new URL(path, import.meta.url));
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path} is not PNG`);
  assert.equal(data.subarray(12, 16).toString("ascii"), "IHDR", `${path} has no IHDR`);
  return {
    size: data.length,
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25],
  };
}

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
  assert.match(workflow, /migration_base=1900000000/,
               "the new strategy stays above any pre-switch 2026 Unix-seconds versionCode");
  assert.match(workflow, /run_number="\$\{GITHUB_RUN_NUMBER\}"/);
  assert.match(workflow, /attempt="\$\{GITHUB_RUN_ATTEMPT\}"/);
  assert.match(workflow, /version_code=\$\(\( migration_base \+ run_number \* 100 \+ attempt \)\)/,
               "run number and retry remain monotonic without consuming wall-clock seconds");
  assert.match(workflow, /version_code > 2100000000/,
               "the release generator refuses values above Google Play's versionCode ceiling");
  assert.match(workflow, /LINGUA_ANDROID_VERSION_CODE=\$\{version_code\}/);
  assert.match(workflow, /LINGUA_ANDROID_VERSION_NAME=1\.0\.\$\{GITHUB_RUN_NUMBER\}\.\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.equal((workflow.match(/date -u \+%s/g) || []).length, 1,
               "only iOS still uses epoch seconds; Android has a migration-safe monotonic sequence");
  assert.match(workflow, /LINGUA_IOS_BUILD_NUMBER=\$\(date -u \+%s\)/);
  for (const job of ["android", "ios"]) {
    const section = workflow.split(`\n  ${job}:`)[1].split("\n  ")[0];
    assert.doesNotMatch(section.split("\n    steps:")[0], /\$\{\{ secrets\./);
  }
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\.temp\s*\}\}/,
    "runner context is invalid in a job-level env block");
  assert.doesNotMatch(workflow, /uses:\s+[^\n]+@(v\d+|main|master)\s*$/m);
  assert.ok(workflow.indexOf("npm ci && npm run check && npm run sync")
    < workflow.indexOf("Materialize signing credentials"));
  assert.match(workflow, /node scripts\/store-preflight\.mjs android/);
  assert.match(workflow, /node scripts\/store-preflight\.mjs ios/);
  assert.match(workflow, /keytool -exportcert/);
  assert.match(workflow, /MOBILE_ANDROID_CERT_SHA256="\$fingerprint"/);
  assert.ok(workflow.indexOf("Verify live Android launch contract")
    < workflow.indexOf("Upload Android internal beta"));
  assert.ok(workflow.indexOf("Verify live iOS launch contract")
    < workflow.indexOf("Upload TestFlight beta"));
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

test("store preflight rejects live backend, build, provider, and association drift", () => {
  const bootstrap = {
    protocol: MOBILE_PROTOCOL,
    minimum_client_build: 1,
    public_origin: PUBLIC_ORIGIN,
    account_mode: "session",
    call_lifecycle: "foreground",
    max_room_participants: 2,
  };
  assert.equal(MOBILE_PROTOCOL, 2,
               "session-v2 issuance is a deliberate installed-client protocol boundary");
  assert.equal(PLAY_VERSION_CODE_MAX, 2_100_000_000);
  assert.equal(releaseBuildNumber("android", {LINGUA_ANDROID_VERSION_CODE: "1900000101"}), 1_900_000_101);
  assert.equal(releaseBuildNumber("ios", {LINGUA_IOS_BUILD_NUMBER: "456"}), 456);
  assert.throws(() => releaseBuildNumber("android", {}), /build number/);
  assert.throws(() => releaseBuildNumber("android", {LINGUA_ANDROID_VERSION_CODE: "2100000001"}),
    /Google Play maximum/);
  assert.equal(validateBootstrap(bootstrap, 1_900_000_101), true);
  assert.throws(() => validateBootstrap({...bootstrap, protocol: 1}, 1_900_000_101),
    /protocol mismatch/);
  assert.throws(() => validateBootstrap({...bootstrap, minimum_client_build: 1_900_000_102}, 1_900_000_101),
    /requires mobile build 1900000102/);
  assert.throws(() => validateBootstrap({...bootstrap, max_room_participants: 4}, 1_900_000_101), /two-person/);
  assert.throws(() => validateBootstrap({...bootstrap, public_origin: "https://attacker.test"}, 1_900_000_101),
    /public origin/);

  assert.equal(validateProviderSnapshot({providers: ["google"]}, "android"), true);
  assert.equal(validateProviderSnapshot({providers: ["google", "apple"]}, "ios"), true);
  assert.throws(() => validateProviderSnapshot({providers: ["google"]}, "ios"), /Apple login/);
  assert.throws(() => validateProviderSnapshot({providers: []}, "android"), /no sign-in provider/);

  const teamId = "TESTTEAM01";
  assert.equal(validateAppleAssociation({applinks: {details: [{
    appID: `${teamId}.${APP_ID}`,
    components: [{"/": "/room/*"}],
  }]}}, teamId), true);
  assert.throws(() => validateAppleAssociation({applinks: {details: []}}, teamId),
    /does not contain/);

  const fingerprint = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
  assert.equal(normalizeFingerprint(fingerprint.toLowerCase()), fingerprint);
  assert.equal(validateAndroidAssociation([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: APP_ID,
      sha256_cert_fingerprints: [fingerprint],
    },
  }], fingerprint), true);
  assert.throws(() => validateAndroidAssociation([], fingerprint), /does not contain/);
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
  assert.match(declarations, /Account required to START a call/);
  assert.match(declarations, /No account is required to JOIN one/);
  assert.match(declarations, /iOS login release gate/);
  assert.match(declarations, /production Apple provider is not fully configured and visible/);
  assert.match(declarations, /Room capacity: exactly two participants total/);
  assert.match(declarations, /No password is ever created, collected, or stored/);
  assert.match(declarations, /Monetization: version 1\.0 has no purchase surface/);
  assert.doesNotMatch(declarations, /Buy credits/i,
                      "the shipping declarations cannot resurrect the retired purchase preview");
  assert.match(declarations, /Account deletion: available in the app/);
  assert.match(declarations, /No advertising/);
  assert.match(declarations, /No transcript history/);
  assert.match(declarations, /foreground only/i);
});

test("Play listing has its mandatory icon and feature graphic", async () => {
  const generator = await read("../scripts/generate-assets.py");
  assert.match(generator, /PLAY_STORE/);
  assert.match(generator, /featureGraphic\.png/);
  assert.match(generator, /icon\.png/);

  const icon = await pngInfo("../fastlane/metadata/android/en-US/images/icon.png");
  assert.deepEqual(
    {width: icon.width, height: icon.height, bitDepth: icon.bitDepth, colorType: icon.colorType},
    {width: 512, height: 512, bitDepth: 8, colorType: 6},
  );
  assert.ok(icon.size <= 1024 * 1024, "Play listing icon exceeds 1 MiB");

  const feature = await pngInfo("../fastlane/metadata/android/en-US/images/featureGraphic.png");
  assert.deepEqual(
    {width: feature.width, height: feature.height, bitDepth: feature.bitDepth, colorType: feature.colorType},
    {width: 1024, height: 500, bitDepth: 8, colorType: 2},
  );
});

test("both stores have two accepted-size phone screenshots", async () => {
  for (const path of [
    "../fastlane/metadata/android/en-US/images/phoneScreenshots/01-dashboard.png",
    "../fastlane/metadata/android/en-US/images/phoneScreenshots/02-room.png",
    "../fastlane/screenshots/en-US/01-dashboard.png",
    "../fastlane/screenshots/en-US/02-room.png",
  ]) assert.ok((await stat(new URL(path, import.meta.url))).size > 50000, path);
});

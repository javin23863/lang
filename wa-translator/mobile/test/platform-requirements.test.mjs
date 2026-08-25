import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Android release config targets the current Play API floor", async () => {
  const gradle = await read("../android/variables.gradle");
  assert.match(gradle, /compileSdkVersion\s*=\s*36\b/);
  assert.match(gradle, /targetSdkVersion\s*=\s*36\b/);
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

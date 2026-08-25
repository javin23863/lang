import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mobile = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, mobile), "utf8");

test("store metadata matches the shipping private two-person account model", async () => {
  const [androidTitle, androidShort, androidFull, androidChangelog, iosName, iosSubtitle,
    iosDescription, iosKeywords, iosSupport, iosPrivacy, iosMarketing, iosReleaseNotes] = await Promise.all([
    read("fastlane/metadata/android/en-US/title.txt"),
    read("fastlane/metadata/android/en-US/short_description.txt"),
    read("fastlane/metadata/android/en-US/full_description.txt"),
    read("fastlane/metadata/android/en-US/changelogs/default.txt"),
    read("fastlane/metadata/ios/en-US/name.txt"),
    read("fastlane/metadata/ios/en-US/subtitle.txt"),
    read("fastlane/metadata/ios/en-US/description.txt"),
    read("fastlane/metadata/ios/en-US/keywords.txt"),
    read("fastlane/metadata/ios/en-US/support_url.txt"),
    read("fastlane/metadata/ios/en-US/privacy_url.txt"),
    read("fastlane/metadata/ios/en-US/marketing_url.txt"),
    read("fastlane/metadata/ios/en-US/release_notes.txt"),
  ]);

  assert.equal(androidTitle.trim(), "Lingua Relay");
  assert.equal(iosName.trim(), "Lingua Relay");
  assert.ok(androidShort.trim().length <= 80, "Google short description stays within 80 characters");
  assert.ok(iosSubtitle.trim().length <= 30, "App Store subtitle stays within 30 characters");
  assert.ok(iosKeywords.trim().length <= 100, "App Store keywords stay within 100 characters");
  assert.equal(androidFull, iosDescription, "Android and iOS describe the same product contract");

  const copy = androidFull.toLowerCase();
  for (const required of [
    "signed-in host",
    "private two-person room",
    "without creating an account",
    "no public directory",
    "random matching",
    "video, voice, or text chat",
    "report and block",
    "not kept as transcript history",
  ]) assert.ok(copy.includes(required), `store description includes ${required}`);

  for (const stale of [
    "does not require an account",
    "four people",
    "4 people",
    "anonymous matching",
    "public rooms",
    "buy credits",
    "subscription",
  ]) assert.ok(!copy.includes(stale), `store description excludes stale claim: ${stale}`);

  for (const [surface, value] of [
    ["Android short description", androidShort],
    ["iOS subtitle", iosSubtitle],
    ["Android closed-test changelog", androidChangelog],
    ["iOS TestFlight release notes", iosReleaseNotes],
  ]) {
    const lower = value.toLowerCase();
    for (const mode of ["video", "voice", "chat"]) {
      assert.ok(lower.includes(mode), `${surface} includes shipping ${mode} mode`);
    }
    assert.ok(!/video (?:rooms|calls)[.!]?\s*$/i.test(value.trim()),
      `${surface} cannot describe a multi-mode product as video-only`);
  }

  for (const value of [iosSupport, iosPrivacy, iosMarketing]) {
    const url = new URL(value.trim());
    assert.equal(url.protocol, "https:");
    assert.ok(!url.hostname.includes("localhost"));
  }
});

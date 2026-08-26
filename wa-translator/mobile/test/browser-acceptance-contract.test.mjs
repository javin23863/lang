import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const browser = new URL("../../tools/browser/", import.meta.url);
const mobile = new URL("../", import.meta.url);

async function source(name) {
  return readFile(new URL(name, browser), "utf8");
}

async function mobileSource(name) {
  return readFile(new URL(name, mobile), "utf8");
}

test("real-browser acceptance follows current auth and affirmative-consent contracts", async () => {
  const [session, consent, journey, pair, dashboard, run] = await Promise.all([
    source("session.mjs"),
    source("room-consent.mjs"),
    source("journey.mjs"),
    source("pair.mjs"),
    source("dashboard.mjs"),
    source("run.mjs"),
  ]);

  assert.match(session, /process\.env\.LINGUA_SESSION/);
  assert.match(session, /must be a current s2 browser session/);
  assert.doesNotMatch(session, /crypto\.subtle\.sign|process\.env\.ROOM_SIGNING_KEY/,
    "browser acceptance must not forge a host session that lacks a live account");

  assert.match(consent, /fresh room must start with Terms unchecked and Join disabled/);
  assert.match(consent, /await page\.tap\("#termsAgree"\)/);
  assert.match(consent, /accepting Terms must enable Join/);

  for (const [name, script] of [["journey", journey], ["pair", pair], ["dashboard", dashboard]]) {
    assert.match(script, /acceptRoomTerms/,
      `${name} browser acceptance must cross the affirmative Terms gate`);
    assert.doesNotMatch(script, /terms pre-checked|GET \/api\/me is stubbed|dev session minted locally/,
      `${name} browser acceptance must not preserve retired auth/consent assumptions`);
  }

  assert.match(journey, /browser journey could not create room \(HTTP/);
  assert.match(pair, /pair journey could not create room \(HTTP/);
  assert.match(dashboard, /const session = await sessionToken\(\)/);
  assert.match(run, /LINGUA_SESSION is required/);
  assert.doesNotMatch(run, /ROOM_SIGNING_KEY/,
    "the browser entrypoint must not claim a signing key is sufficient for host acceptance");
});

test("store screenshots retain exact-head provenance through promotion and resizing", async () => {
  const [run, promotion, preparation, packageText] = await Promise.all([
    source("run.mjs"),
    mobileSource("scripts/promote-browser-screenshots.py"),
    mobileSource("scripts/prepare-store-screenshots.py"),
    mobileSource("package.json"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.match(run, /en: "en-US"/,
    "the real-browser sweep must have a canonical English store-listing locale");
  assert.match(run, /writeFile\(path\.join\(SHOTS, "capture\.json"\)/);
  assert.match(run, /head,\s*origin: ORIGIN,\s*languages: LANGUAGES/,
    "capture provenance must record the exact source head and selected language sweep");
  assert.match(run, /if \(!failed\.length\)/,
    "failed browser journeys must never receive a promotable capture manifest");

  assert.match(promotion, /CAPTURE_SIZE = \(390, 844\)/);
  assert.match(promotion, /manifest\.get\("head"\) != head/,
    "promotion must reject screenshots captured from any other source head");
  assert.match(promotion, /"en" not in languages/,
    "promotion must require the en-US acceptance sweep");
  assert.match(promotion, /PROVENANCE = TARGET \/ "promotion\.json"/);
  assert.match(promotion, /"source_head": head/,
    "the promoted screenshot set must retain the exact captured source SHA");
  assert.match(promotion, /"captured_at": completed_at/);
  assert.match(promotion, /"sha256": sha256\(target\)/,
    "every promoted PNG must be cryptographically bound to its provenance record");
  for (const mapping of [
    ["dash-en.png", "01-dashboard.png"],
    ["dash-en-room.png", "02-room-control.png"],
    ["gate-en.png", "03-choose-language.png"],
    ["room-live-en.png", "04-room.png"],
  ]) {
    assert.ok(promotion.includes(`("${mapping[0]}", "${mapping[1]}")`),
      `store screenshot mapping missing: ${mapping[0]} -> ${mapping[1]}`);
  }

  assert.match(preparation, /PROVENANCE = SOURCE \/ "promotion\.json"/);
  assert.match(preparation, /promotion\.json source_head is not an exact commit SHA/);
  assert.match(preparation, /sha256\(path\) != expected_hash/,
    "store resizing must reject a promoted PNG changed after exact-head promotion");
  assert.match(preparation, /RECEIPT = ROOT \/ "build" \/ "store-screenshot-receipt\.json"/,
    "final provenance must stay outside Fastlane image directories");
  assert.match(preparation, /"android": \{"size": \[1080, 2340\], "files": android\}/);
  assert.match(preparation, /"ios": \{"size": \[1290, 2796\], "files": ios\}/);
  assert.match(preparation, /outputs\.append\(\{"file": output_name, "sha256": sha256\(output\)\}\)/,
    "the final store-sized PNGs must be hashed into the receipt");

  assert.equal(packageJson.scripts["screenshots:refresh"],
    "python scripts/run-store-screenshot-tool.py refresh");
});

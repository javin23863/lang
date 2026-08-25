import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const browser = new URL("../../tools/browser/", import.meta.url);

async function source(name) {
  return readFile(new URL(name, browser), "utf8");
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
  assert.doesNotMatch(session, /crypto\.subtle\.sign|ROOM_SIGNING_KEY/,
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

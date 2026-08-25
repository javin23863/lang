import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Version 1.0 has one explicit product contract and historical docs cannot outrank it", async () => {
  const release = await read("../../../RELEASE-1.0.md");
  const readme = await read("../../../README.md");
  const plan = await read("../../../MOBILE-STORE-PLAN.md");
  const reuse = await read("../../../MOBILE-STORE-REUSE-SOURCES.md");
  const handoff = await read("../../../MOBILE-STORE-HANDOFF.md");

  assert.match(release, /authoritative product boundary/i);
  assert.match(release, /exactly one local participant and one remote participant/i);
  assert.match(release, /host must sign in before creating a room/i);
  assert.match(release, /invited participant.*does \*\*not\*\* need an account/is);
  assert.match(release, /Version 1\.0 is non-monetized/i);
  assert.match(release, /max_room_participants:[\s`]*2/,
               "installed clients fail closed on any non-two-person backend contract");
  assert.match(release, /New external browser\/native sessions use the `s2` format/i,
               "the release contract requires independently issued external sessions");
  assert.match(release, /random 128-bit issuance nonce/i);
  assert.match(release, /temporarily accepts valid legacy `s1` sessions/i,
               "legacy sessions are migration compatibility, not the issuance contract");
  assert.match(release, /protocol is `2`/,
               "the installed-client compatibility boundary changes with the new session format");
  assert.match(release,
    /`session-issuance-entry\.ts` → `account-guard-entry\.ts` → `launch-entry\.ts` →\s*`mobile-entry\.ts`/,
    "the documented shipping chain includes the v2 issuance boundary");
  assert.match(release, /Do not deploy the base `worker\.ts` `Room` directly/);

  assert.match(readme, /RELEASE-1\.0\.md/,
               "the repository entry point sends developers to the current contract first");
  assert.match(readme, /Exactly \*\*two joined participants\*\*/);
  assert.doesNotMatch(readme, /up to four browsers|host supports four total callers|Each room can contain four people/i);
  assert.doesNotMatch(readme, /still has no accounts or database/i);

  for (const [name, source] of [
    ["plan", plan], ["reuse research", reuse], ["handoff", handoff],
  ]) {
    assert.match(source, /historical|superseded/i, `${name} labels its dated scope`);
    assert.match(source, /RELEASE-1\.0\.md/, `${name} points to the current product contract`);
  }

  assert.doesNotMatch(plan, /first store release is a free, accountless/i);
  assert.doesNotMatch(reuse, /free,\s*accountless foreground-call launch/i);
});

test("browser and native room generators apply the same bounded control-plane fetch contract", async () => {
  const launch = await read("../../cloudflare/src/launch-entry.ts");
  const prepare = await read("../scripts/prepare-web.mjs");

  for (const source of [launch, prepare]) {
    assert.match(source, /ROOM_CONTROL_FETCH_TIMEOUT_MS = 12000/);
    assert.match(source, /async function roomFetch\(input, init = \{\}\)/);
    assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), ROOM_CONTROL_FETCH_TIMEOUT_MS\)/);
    assert.match(source, /CONTROL_FETCH_SEAMS = \["\/api\/capabilities", "\/api\/turn", "\/api\/room", "\/api\/reports"\]/);
    assert.match(source, /normalized = normalized\.replace/,
                 "both generators rewrite each control-plane fetch through roomFetch");
  }
});

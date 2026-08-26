import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const roomModel = await readFile(new URL("../www/dashboard-room-model.js", import.meta.url), "utf8");
const controller = await readFile(new URL("../www/dashboard-room-controller.js", import.meta.url), "utf8");

test("room retirement is a checked overwrite followed by best-effort deletion", () => {
  assert.match(roomModel, /const REVOKED_RECORD = '\{\"revoked\":true\}'/);
  assert.match(roomModel,
    /async function forget\(\) \{[\s\S]*?retired = await runtime\.saveHostRoom\(REVOKED_RECORD\) === true;[\s\S]*?await runtime\.forgetHostRoom\(\);[\s\S]*?return retired;[\s\S]*?\}/,
    "silent delete failure is safe only after a confirmed overwrite has destroyed the bearer");
});

test("ordinary room clearing keeps known custody until persistent retirement is confirmed", () => {
  assert.match(controller,
    /async function clear\(state, key\) \{[\s\S]*?if \(!await model\.forget\(\)\) \{[\s\S]*?setCustodyUnavailable\(true\);[\s\S]*?preserveRoom: true[\s\S]*?return false;[\s\S]*?room = null;/,
    "server closure alone cannot make the UI forget a bearer that may still be usable at rest");
});

test("discard holds the controller lock while persistent retirement is in flight", () => {
  assert.match(controller,
    /async function discard\(\) \{\s*const acquiredBusy = !busy;\s*if \(acquiredBusy\) setBusy\(true\);\s*invalidationGeneration\+\+;\s*stopPolling\(\);\s*room = null;[\s\S]*?const retired = await model\.forget\(\);[\s\S]*?setCustodyUnavailable\(!retired\);[\s\S]*?return retired;[\s\S]*?finally \{\s*if \(acquiredBusy\) setBusy\(false\);\s*\}/,
    "foreground restore cannot race a tombstone write during sign-out or account teardown");
});

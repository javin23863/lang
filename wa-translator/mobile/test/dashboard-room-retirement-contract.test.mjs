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

test("discard drops in-memory control before returning persistent retirement status", () => {
  assert.match(controller,
    /async function discard\(\) \{\s*invalidationGeneration\+\+;\s*stopPolling\(\);\s*room = null;\s*return await model\.forget\(\);\s*\}/,
    "account custody needs a confirmed retirement result without keeping stale host control live in memory");
});

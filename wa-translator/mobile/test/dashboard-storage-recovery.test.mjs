import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);
const runtime = await readFile(new URL("app-runtime.js", root), "utf8");
const dashboard = await readFile(new URL("dashboard.js", root), "utf8");

test("host-room storage read failure is not converted into an empty slot", () => {
  assert.match(runtime,
    /async function loadHostRoom\(\) \{\s*return native\s*\? await window\.LinguaNative\.getItem\(hostRoomKey\)\s*:\s*localStorage\.getItem\(hostRoomKey\);\s*\}/,
    "secure/local storage exceptions must propagate to the custody controller");
  const start = runtime.indexOf("async function loadHostRoom()");
  const end = runtime.indexOf("async function saveHostRoom", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(runtime.slice(start, end), /catch\s*\{/,
    "read failure cannot masquerade as no persisted host control");
});

test("foreground and online recovery retry persisted custody before polling", () => {
  assert.match(dashboard,
    /onVisible:\s*async \(\) => \{[\s\S]*?if \(account\?\.signed_in\) await roomController\.restore\(\);[\s\S]*?roomController\.refresh\(\);[\s\S]*?await refreshAccountIfUnavailable\(\);[\s\S]*?\}/,
    "a signed-in app retries an unread storage slot when it becomes usable again");
});

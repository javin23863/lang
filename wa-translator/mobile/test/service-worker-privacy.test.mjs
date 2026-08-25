import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("service worker caches only the credential-free dashboard shell", async () => {
  const source = await readFile(new URL("sw.js", root), "utf8");

  assert.match(source, /const CACHE_NAME = 'lingua-relay-shell-v2'/);
  for (const safe of [
    "'/index.html'", "'/design-tokens.css'", "'/dashboard.css'",
    "'/dashboard-api.js'", "'/dashboard-room-controller.js'", "'/product-events.js'",
    "'/icon.svg'", "'/manifest.webmanifest'",
  ]) assert.ok(source.includes(safe), `safe shell includes ${safe}`);

  for (const forbidden of [
    "path === '/room.html'", "path.startsWith('/room/')", "path.startsWith('/ws/')",
    "path.startsWith('/api/')", "path.startsWith('/auth/')", "path.startsWith('/static/i18n/')",
  ]) assert.ok(source.includes(forbidden), `network-only guard includes ${forbidden}`);

  assert.match(source, /request\.method !== 'GET' \|\| networkOnly\(path\)/);
  assert.match(source, /fetch\(request, \{cache: 'no-store'\}\)/);
  assert.match(source, /if \(!SHELL_PATHS\.has\(path\)\)/);
  assert.match(source, /await cache\.put\(request, response\.clone\(\)\)/);
  assert.match(source, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);

  // Capability-bearing and user-content shapes must never be promoted into the
  // fixed allowlist, even by a future refactor.
  const shellBlock = source.match(/const SHELL_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  for (const forbidden of ["/room/", "/api/", "/auth/", "/ws/", "token", "caption", "transcript"]) {
    assert.ok(!shellBlock.toLowerCase().includes(forbidden), `shell allowlist excludes ${forbidden}`);
  }
});

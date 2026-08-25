import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("service worker caches only coherent credential-free dashboard shell generations", async () => {
  const source = await readFile(new URL("sw.js", root), "utf8");

  assert.match(source, /const CACHE_NAME = 'lingua-relay-shell-v4'/);
  for (const safe of [
    "'/index.html'", "'/design-tokens.css'", "'/dashboard.css'",
    "'/dashboard-api.js'", "'/dashboard-room-controller.js'", "'/product-events.js'",
    "'/icon.svg'", "'/manifest.webmanifest'",
  ]) assert.ok(source.includes(safe), `safe shell includes ${safe}`);

  for (const forbidden of [
    "path === '/room.html'", "path.startsWith('/room/')", "path.startsWith('/ws/')",
    "path.startsWith('/api/')", "path.startsWith('/auth/')", "path.startsWith('/static/i18n/')",
  ]) assert.ok(source.includes(forbidden), `network-only guard includes ${forbidden}`);

  assert.match(source, /url\?\.origin === self\.location\.origin/,
    "cross-origin requests can never enter the shell cache");
  assert.match(source, /url\.search === ''/,
    "query-bearing requests can never enter the shell cache");
  assert.match(source, /request\.method === 'GET'/);
  assert.match(source, /SHELL_PATHS\.has\(url\.pathname\)/);
  assert.match(source, /credentials: 'omit'/,
    "shell refreshes never send account cookies or browser credentials");
  assert.match(source, /new Request\(new URL\(path, self\.location\.origin\)\.toString\(\)/,
    "cache keys are canonical fixed shell URLs, not browser requests");
  assert.match(source, /await cache\.addAll\(shellRequests\(\)\)/,
    "a dashboard refresh fetches the complete allowlisted shell generation");
  assert.match(source, /const cache = await refreshShell\(\)/);
  assert.match(source, /DASHBOARD_PATHS\.has\(url\.pathname\)/);
  assert.match(source, /dashboardNavigation\(request, url\)/);
  assert.match(source, /if \(url\.search === ''\)/);
  assert.match(source, /fetch\(request, \{cache: 'no-store'\}\)/,
    "query-bearing or dynamic browser requests remain network-only");
  assert.match(source, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
  assert.doesNotMatch(source, /cache\.put\(request/,
    "browser requests carrying credentials or headers are never persisted");
  assert.doesNotMatch(source, /event\.waitUntil\(fresh\)/,
    "unversioned assets are not mutated independently in the background");

  // Capability-bearing and user-content shapes must never be promoted into the
  // fixed allowlist, even by a future refactor. "design-tokens.css" is a safe
  // shell asset, so reject capability-specific shapes rather than the generic
  // substring "token".
  const shellBlock = source.match(/const SHELL_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  for (const forbidden of [
    "/room.html", "/room/", "/api/", "/auth/", "/ws/", "bearer", "host_control",
    "room_id", "caption", "transcript", "?", "#",
  ]) assert.ok(!shellBlock.toLowerCase().includes(forbidden), `shell allowlist excludes ${forbidden}`);
});

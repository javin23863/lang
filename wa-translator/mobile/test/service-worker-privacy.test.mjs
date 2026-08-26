import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("service worker caches only coherent credential-free dashboard shell generations", async () => {
  const source = await readFile(new URL("sw.js", root), "utf8");

  assert.match(source, /const CACHE_NAME = 'lingua-relay-shell-v5'/);
  for (const safe of [
    "'/index.html'", "'/design-tokens.css'", "'/dashboard.css'", "'/app-runtime.js'",
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

test("shared runtime is network-first online with credential-free cached fallback", async () => {
  const source = await readFile(new URL("sw.js", root), "utf8");

  assert.match(source,
    /const NETWORK_FIRST_SHELL_PATHS = new Set\(\['\/app-runtime\.js'\]\)/,
    "the shared room runtime cannot remain cache-first after transport fixes deploy");
  assert.match(source, /async function networkFirstShell\(url\) \{/);
  assert.match(source, /return await fetch\(canonicalShellRequest\(url\.pathname\)\)/,
    "network-first runtime fetches use the credential-free canonical request");
  assert.match(source, /const cached = await cachedShell\(url\.pathname\)/);
  assert.match(source, /if \(cached\) return cached/,
    "the previous credential-free runtime remains an offline fallback");
  assert.match(source,
    /cacheableShellRequest\(request, url\)\s+&& NETWORK_FIRST_SHELL_PATHS\.has\(url\.pathname\)/,
    "only an admitted fixed shell URL can enter the network-first path");
  assert.match(source, /event\.respondWith\(networkFirstShell\(url\)\)/);
});

test("service worker admission helpers reject query/cross-origin state and canonicalize cache requests", async () => {
  const source = await readFile(new URL("sw.js", root), "utf8");
  const definitions = source.slice(0, source.indexOf("self.addEventListener('install'"));
  assert.ok(definitions.length > 0, "service worker helper boundary is present");

  const context = vm.createContext({
    self: {location: {origin: "https://lingua.test"}},
    URL,
    Request,
  });
  vm.runInContext(definitions, context, {filename: "sw.js"});

  function admitted(url, init = undefined) {
    context.testRequest = new Request(url, init);
    context.testUrl = new URL(url);
    return vm.runInContext("cacheableShellRequest(testRequest, testUrl)", context);
  }

  assert.equal(admitted("https://lingua.test/dashboard.css"), true);
  assert.equal(admitted("https://lingua.test/app-runtime.js"), true);
  assert.equal(admitted("https://lingua.test/app-runtime.js?v=stale-bypass"), false);
  assert.equal(admitted("https://lingua.test/dashboard.css?token=secret"), false);
  assert.equal(admitted("https://evil.test/dashboard.css"), false);
  assert.equal(admitted("https://lingua.test/api/me"), false);
  assert.equal(admitted("https://lingua.test/dashboard.css", {method: "POST"}), false);

  const canonical = vm.runInContext("canonicalShellRequest('/dashboard.css')", context);
  assert.equal(canonical.url, "https://lingua.test/dashboard.css");
  assert.equal(canonical.method, "GET");
  assert.equal(canonical.credentials, "omit");
  assert.equal(canonical.cache, "no-store");
  assert.equal(canonical.headers.has("Authorization"), false);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("native session injection is origin-bound and narrowly scoped", async () => {
  const bridge = await read("../src/mobile-bridge.ts");
  assert.match(bridge,
    /SESSION_API_PATHS = new Set\(\[\s*"\/api\/v1\/me", "\/api\/v1\/rooms", "\/api\/v1\/account\/delete", "\/api\/v1\/auth\/logout"\s*\]\)/,
    "only account state, room creation, deletion, and logout receive the native session");
  assert.match(bridge, /url\.origin === PUBLIC_ORIGIN && SESSION_API_PATHS\.has\(url\.pathname\)/,
               "the session bearer is never attached to another origin");
  assert.match(bridge, /!request\.headers\.has\("Authorization"\)/,
               "room-scoped credentials are never overwritten by the account session");
  assert.doesNotMatch(bridge, /SESSION_API_PATHS[\s\S]*?\/api\/v1\/turn/);
  assert.doesNotMatch(bridge, /SESSION_API_PATHS[\s\S]*?\/api\/v1\/tts/);
  assert.doesNotMatch(bridge, /SESSION_API_PATHS[\s\S]*?\/api\/v1\/reports/);
});

test("native one-time auth handoffs are idempotent across cold-launch delivery", async () => {
  const bridge = await read("../src/mobile-bridge.ts");
  assert.match(bridge, /const handledAuthHandoffs = new Set<string>\(\)/);
  assert.match(bridge, /if \(handledAuthHandoffs\.has\(auth\.handoff\)\) return/);
  assert.match(bridge, /handledAuthHandoffs\.add\(auth\.handoff\)/);
  assert.match(bridge, /App\.addListener\("appUrlOpen"/);
  assert.match(bridge, /App\.getLaunchUrl\(\)/,
               "both Capacitor delivery paths remain supported while duplicate handoffs are ignored");
});

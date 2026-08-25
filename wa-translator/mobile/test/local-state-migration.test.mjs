import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mobile = new URL("../", import.meta.url);

test("installed upgrades preserve only intentional local compatibility seams", async () => {
  const bridge = await readFile(new URL("src/mobile-bridge.ts", mobile), "utf8");
  const roomModel = await readFile(new URL("../windows/static/dashboard-room-model.js", mobile), "utf8");

  assert.match(bridge, /const NATIVE_SESSION_KEY = "lingua-relay\.native-session\.v1"/,
    "existing secure session key remains stable across the session-token upgrade");
  assert.match(bridge, /const NATIVE_AUTH_BINDING_PREFIX = "lingua-relay\.native-auth-binding\.v3\."/);
  assert.match(bridge, /const LEGACY_AUTH_BINDING_PREFIX = "lingua-relay\.native-auth-binding\.v2\."/);
  assert.match(bridge, /canonicalBinding\(localStorage\.getItem\(legacyAuthBindingKey\(provider\)\)\)/);
  assert.match(bridge, /await hostStorage\.setItem\(authBindingKey\(provider\), binding\)/);
  assert.match(bridge, /if \(!migratedLegacy \|\| persisted\) \{[\s\S]*?localStorage\.removeItem\(legacyAuthBindingKey\(provider\)\)/,
    "legacy auth material is removed only after safe migration or when no migration was needed");
  assert.match(bridge, /if \(isSessionToken\(value\)\) \{[\s\S]*?nativeSession = value/);
  assert.match(bridge, /if \(value\) await hostStorage\.removeItem\(NATIVE_SESSION_KEY\)/,
    "malformed persisted sessions self-clean on upgrade");

  assert.match(roomModel, /return MODES\.has\(value\) \? value : "video"/,
    "rooms saved before mode support keep the historical video behavior");
  assert.match(roomModel, /return valid\(value\) \? value : null/,
    "malformed old room state fails closed rather than entering room control");
});

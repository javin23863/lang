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

test("stale native sessions clear themselves on auth failure or signed-out account state", async () => {
  const bridge = await read("../src/mobile-bridge.ts");
  assert.match(bridge, /async function clearNativeSession\(\): Promise<void>/);
  assert.match(bridge, /attachedNativeSession && response\.status === 401/,
               "an expired bearer returned by a protected endpoint is removed");
  assert.match(bridge, /response\.clone\(\)\.json\(\)/,
               "account state is inspected without consuming the response returned to the dashboard");
  assert.match(bridge, /account\.signed_in === false/,
               "the deliberately 200 signed-out /me response also retires a stale bearer");
  assert.match(bridge, /if \(clearSession\) await clearNativeSession\(\)/);
});

test("native auth keeps the raw binding on-device and exposes only its challenge", async () => {
  const bridge = await read("../src/mobile-bridge.ts");
  assert.match(bridge, /NATIVE_AUTH_BINDING_PREFIX = "lingua-relay\.native-auth-binding\.v3\."/);
  assert.match(bridge, /await hostStorage\.setItem\(authBindingKey\(provider\), binding\)/,
               "current bindings use the platform secure-storage adapter");
  assert.match(bridge, /crypto\.subtle\.digest\("SHA-256", new TextEncoder\(\)\.encode\(binding\)\)/,
               "the browser receives a one-way challenge rather than the binding");
  assert.match(bridge, /\?challenge=\$\{encodeURIComponent\(challenge\)\}/);
  assert.doesNotMatch(bridge, /\?binding=\$\{encodeURIComponent\(binding\)\}/,
                      "current native start URLs never contain the raw binding");
  assert.doesNotMatch(bridge, /localStorage\.setItem\(authBindingKey\(provider\), binding\)/,
                      "current bindings are never written to WebView localStorage");
  assert.match(bridge, /LEGACY_AUTH_BINDING_PREFIX/,
               "an older in-flight localStorage binding can be migrated once rather than stranded");
  assert.match(bridge, /let migratedLegacy = false/);
  assert.match(bridge, /if \(legacy\) \{\s*binding = legacy;\s*migratedLegacy = true;/,
               "the bridge knows when the current proof exists only in legacy storage");
  assert.match(bridge, /let persisted = false;[\s\S]*?await hostStorage\.setItem\(authBindingKey\(provider\), binding\);\s*persisted = true/,
               "secure migration success is tracked explicitly");
  assert.match(bridge, /if \(!migratedLegacy \|\| persisted\) \{\s*try \{ localStorage\.removeItem\(legacyAuthBindingKey\(provider\)\); \}/,
               "a legacy in-flight proof is not deleted until secure storage really has it");
});

test("native one-time handoffs remain idempotent and retire their proof after every terminal attempt", async () => {
  const bridge = await read("../src/mobile-bridge.ts");
  assert.match(bridge, /const handledAuthHandoffs = new Set<string>\(\)/);
  assert.match(bridge, /if \(handledAuthHandoffs\.has\(auth\.handoff\)\) return/);
  assert.match(bridge, /handledAuthHandoffs\.add\(auth\.handoff\)/);
  assert.match(bridge, /const binding = await readAuthBinding\(provider\)/,
               "cold return reloads the same app-held proof before exchanging the handoff");
  assert.match(bridge, /async function retireAuthBinding\(provider: string\): Promise<void>/);
  assert.match(bridge, /memoryAuthBindings\.delete\(provider\);\s*authChallenges\.delete\(provider\);\s*await hostStorage\.removeItem\(authBindingKey\(provider\)\)/,
               "terminal auth removes both in-memory and secure-storage proof state");
  assert.match(bridge, /await hostStorage\.setItem\(NATIVE_SESSION_KEY, nativeSession\);\s*await retireAuthBinding\(provider\)/,
               "success persists the session before retiring the one-attempt proof");
  assert.match(bridge, /catch \{\s*await retireAuthBinding\(provider\);\s*window\.location\.replace\("index\.html\?auth=failed"\)/,
               "failed exchange cannot leave reusable proof material behind");
  assert.match(bridge, /else \{\s*await retireAuthBinding\(auth\.provider\);\s*window\.location\.replace\("index\.html\?auth=failed"\)/,
               "provider-declared failure also retires the proof");
  assert.match(bridge, /App\.addListener\("appUrlOpen"/);
  assert.match(bridge, /App\.getLaunchUrl\(\)/,
               "both Capacitor delivery paths remain supported while duplicate handoffs are ignored");
});

test("native room routing never propagates legacy personal labels", async () => {
  const bridge = await read("../src/mobile-bridge.ts");
  assert.match(bridge, /openRoom\(token: string, mode\?: string\): boolean/);
  assert.match(bridge, /window\.location\.replace\(roomPageUrl\(token, mode\)\)/);
  assert.match(bridge, /openRoom\(link\.token, link\.mode\)/);
  assert.doesNotMatch(bridge, /openRoom\(token: string, mode\?: string, name/);
  assert.doesNotMatch(bridge, /openRoom\(link\.token, link\.mode, name\)/);
});

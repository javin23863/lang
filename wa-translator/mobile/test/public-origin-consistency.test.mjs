import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

function quotedValue(source, key) {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  assert.ok(match, `${key} must be present`);
  return match[1];
}

function exportedString(source, name) {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*\\n?\\s*"([^"]+)"`));
  assert.ok(match, `${name} must be an exported string`);
  return match[1];
}

test("production public origin has one mobile source and Worker config cannot drift from it", async () => {
  const runtime = await read("../src/runtime-core.mjs");
  const storePreflight = await read("../scripts/store-preflight.mjs");
  const platformSync = await read("../scripts/sync-platform-origin.mjs");
  const production = await read("../../cloudflare/wrangler.jsonc");
  const development = await read("../../cloudflare/wrangler.dev.jsonc");

  const canonical = exportedString(runtime, "PUBLIC_ORIGIN");
  assert.equal(new URL(canonical).origin, canonical,
               "the mobile public origin must be a bare origin, not a path/query URL");
  assert.equal(new URL(canonical).protocol, "https:",
               "production App/Universal Links and OAuth require HTTPS");
  assert.equal(quotedValue(production, "PUBLIC_ORIGIN"), canonical,
               "Worker OAuth/session/link origin must match the native runtime exactly");

  assert.match(storePreflight,
    /import \{ MOBILE_PROTOCOL, PUBLIC_ORIGIN \} from "\.\.\/src\/runtime-core\.mjs"/,
    "signed-store preflight reads protocol and origin from the canonical mobile runtime");
  assert.doesNotMatch(storePreflight,
    /https:\/\/spoken-translation-room\.spoken-translation-cloudflare\.workers\.dev/,
    "the release preflight must not carry its own stale production hostname literal");
  assert.match(platformSync,
    /import \{ MOBILE_AUTH_SCHEME, PUBLIC_ORIGIN \} from "\.\.\/src\/runtime-core\.mjs"/,
    "native association generation reads the same public origin");

  assert.equal(quotedValue(development, "PUBLIC_ORIGIN"), "http://127.0.0.1:8788",
               "local browser development remains explicitly isolated from production identity");
  assert.notEqual(quotedValue(development, "PUBLIC_ORIGIN"), canonical);
  assert.notEqual(quotedValue(development, "name"), quotedValue(production, "name"),
                  "the development Wrangler config cannot deploy over the production Worker name");
});

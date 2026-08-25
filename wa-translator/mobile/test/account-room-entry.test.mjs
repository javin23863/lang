import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("every Wrangler entrypoint requires a live account before room creation", async () => {
  const guard = await read("../../cloudflare/src/account-guard-entry.ts");
  const production = await read("../../cloudflare/wrangler.jsonc");
  const development = await read("../../cloudflare/wrangler.dev.jsonc");

  for (const config of [production, development]) {
    assert.match(config, /"main"\s*:\s*"src\/account-guard-entry\.ts"/,
                 "development and production must not bypass account authority");
  }
  assert.match(guard, /ROOM_CREATE_PATHS = new Set\(\["\/api\/rooms", "\/api\/v1\/rooms"\]\)/);
  assert.match(guard, /url\.pathname === "\/api\/v1\/rooms" \? "\/api\/v1\/me" : "\/api\/me"/,
               "browser and native room creation reuse their normal authenticated account snapshot");
  assert.match(guard, /body\.signed_in === true/,
               "a signed token is insufficient when UserDirectory says the account no longer exists");
  assert.match(guard, /Max-Age=0/,
               "a stale browser cookie is retired immediately after account deletion");
  assert.match(guard, /Access-Control-Allow-Origin/,
               "native 401 responses remain readable so secure storage can self-clear the bearer");
});

test("browser account refresh retires a stale signed cookie", async () => {
  const guard = await read("../../cloudflare/src/account-guard-entry.ts");
  assert.match(guard, /async function browserAccountSnapshot/);
  assert.match(guard, /request\.method !== "GET" \|\| url\.pathname !== "\/api\/me"/);
  assert.match(guard, /body\.signed_in !== false/,
               "only an authoritative signed-out account snapshot clears the browser credential");
  assert.match(guard, /headers\.append\("Set-Cookie", clearSessionCookie\(\)\)/);
});

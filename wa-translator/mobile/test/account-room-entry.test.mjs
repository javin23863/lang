import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("every Wrangler entrypoint crosses v2 issuance and live-account authority before room creation", async () => {
  const issuance = await read("../../cloudflare/src/session-issuance-entry.ts");
  const guard = await read("../../cloudflare/src/account-guard-entry.ts");
  const production = await read("../../cloudflare/wrangler.jsonc");
  const development = await read("../../cloudflare/wrangler.dev.jsonc");

  for (const config of [production, development]) {
    assert.match(config, /"main"\s*:\s*"src\/session-issuance-entry\.ts"/,
                 "development and production must not bypass session issuance or account authority");
  }
  assert.match(issuance,
    /import accountGuardEntry, \{ AbuseGate, ReportInbox, Room, UserDirectory \} from "\.\/account-guard-entry"/,
    "the shipping session boundary delegates through the account guard");
  assert.match(issuance, /const NATIVE_REPORT_PATH = "\/api\/v1\/reports"/,
               "the installed report route is handled at the outer safety boundary");
  assert.match(issuance, /const report = await nativeReportAndBlock\(request, env, ctx\)/,
               "native report success is given a server-side room-block step");
  assert.match(issuance, /return report \|\| accountGuardEntry\.fetch\(request, env, ctx\)/,
               "all routes not consumed by explicit outer boundaries still cross account authority");
  assert.match(guard, /ROOM_CREATE_PATHS = new Set\(\["\/api\/rooms", "\/api\/v1\/rooms"\]\)/);
  assert.match(guard,
    /url\.pathname\.startsWith\("\/api\/v1\/"\) \? "\/api\/v1\/me" : "\/api\/me"/,
    "browser and native protected mutations reuse their normal authenticated account snapshot");
  assert.match(guard, /const identity = await sessionIdentity\(request, env\)/,
               "the external session is cryptographically inspected before authority checks");
  assert.match(guard, /withLegacySession\(request, identity\)/,
               "only a verified session receives an internal legacy representation");
  assert.match(guard, /body\.signed_in === true/,
               "a signed token is insufficient when UserDirectory says the account no longer exists");
  assert.match(guard, /Max-Age=0/,
               "a stale browser cookie is retired immediately after account deletion");
  assert.match(guard, /Access-Control-Allow-Origin/,
               "native 401 responses remain readable so secure storage can self-clear the bearer");
});

test("browser account refresh retires a stale external cookie", async () => {
  const guard = await read("../../cloudflare/src/account-guard-entry.ts");
  assert.match(guard, /async function accountSnapshot/);
  assert.match(guard,
    /request\.method !== "GET" \|\| !ACCOUNT_SNAPSHOT_PATHS\.has\(url\.pathname\)/);
  assert.match(guard, /if \(body\.signed_in !== true\)/,
               "only an authoritative signed-out account snapshot takes the stale-session branch");
  assert.match(guard, /url\.pathname === "\/api\/me" && hasBrowserSession\(request\)/);
  assert.match(guard, /headers\.append\("Set-Cookie", clearSessionCookie\(\)\)/);
});

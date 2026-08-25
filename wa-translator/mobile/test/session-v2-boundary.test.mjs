import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("shipping entrypoint publishes protocol 2 and never exposes legacy native sessions", async () => {
  const issuance = await read("../../cloudflare/src/session-issuance-entry.ts");
  const production = await read("../../cloudflare/wrangler.jsonc");
  const development = await read("../../cloudflare/wrangler.dev.jsonc");

  for (const config of [production, development]) {
    assert.match(config, /"main"\s*:\s*"src\/session-issuance-entry\.ts"/,
                 "all Worker entrypoints cross the session-v2 issuance boundary");
  }
  assert.match(issuance, /const MOBILE_PROTOCOL = 2/);
  assert.match(issuance, /body\.protocol = MOBILE_PROTOCOL/,
               "the public native bootstrap marks the breaking session-format boundary");
  assert.match(issuance, /const legacy = await inspectSessionToken\(body\.session, env\.ROOM_SIGNING_KEY\)/,
               "the lower handoff session is verified before it can be transformed");
  assert.match(issuance, /legacy\.version !== 1/,
               "only the expected internal legacy handoff credential can be upgraded");
  assert.match(issuance, /body\.expires_at !== legacy\.expiresAt/,
               "handoff JSON cannot lie about the token's signed expiry");
  assert.match(issuance, /await mintSessionV2\(legacy\.userId, env\.ROOM_SIGNING_KEY, legacy\.expiresAt\)/,
               "native handoff preserves expiry while adding independent issuance entropy");
  assert.match(issuance, /headers\.delete\("Set-Cookie"\)/,
               "native handoff never persists a browser-style session into the WebView");
});

test("browser OAuth upgrades legacy callback cookies before they leave the service", async () => {
  const guard = await read("../../cloudflare/src/account-guard-entry.ts");

  assert.ok(guard.includes(
    'const OAUTH_CALLBACK_PATTERN = /^\\/auth\\/(google|apple|facebook)\\/callback$/;'
  ), "the outer boundary intercepts only supported OAuth callbacks");
  assert.ok(guard.includes(
    'const sessionIndex = cookies.findIndex(value => /^lr_s=s1\\./.test(value));'
  ), "only the internal legacy callback cookie is selected for upgrade");
  assert.match(guard, /const legacy = await inspectSessionToken\(token, env\.ROOM_SIGNING_KEY\)/);
  assert.match(guard, /legacy\.version !== 1/);
  assert.match(guard, /await mintSessionV2\(legacy\.userId, env\.ROOM_SIGNING_KEY, legacy\.expiresAt\)/);
  assert.match(guard, /cookies\[sessionIndex\] = cookies\[sessionIndex\]\.replace/);
  assert.match(guard, /headers\.delete\("Set-Cookie"\)/);
  assert.match(guard, /headers\.append\("Set-Cookie", clearSessionCookie\(\)\)/,
               "failure to mint v2 clears rather than leaking a deterministic legacy bearer");
});

test("revocation identity stays bound to the external token while legacy adaptation is internal only", async () => {
  const guard = await read("../../cloudflare/src/account-guard-entry.ts");
  const session = await read("../../cloudflare/src/session-v2.ts");

  assert.match(session, /SESSION_V2_PURPOSE = "session\.v2"/);
  assert.match(session, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
  assert.match(session, /digest: await tokenDigest\(token\)/,
               "revocation digest is calculated from the original external bearer");
  assert.match(session, /legacyToken: await legacyToken\(userId, expiresAt, secret\)/,
               "the legacy token is a separate internal compatibility representation");
  assert.match(guard, /async function sessionRevoked\(identity: SessionIdentity/);
  assert.match(guard, /session-revocations\/\$\{identity\.digest\}/,
               "revocation lookup uses the external-token digest");
  assert.match(guard, /body: JSON\.stringify\(\{digest: identity\.digest, expires_at: identity\.expiresAt\}\)/,
               "revocation writes use the same external-token digest");
  assert.match(guard, /return launchEntry\.fetch\(withLegacySession\(request, identity\), env, ctx\)/,
               "downgrade occurs only for an internal call after external verification/revocation checks");
});

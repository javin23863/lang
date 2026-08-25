import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("active account wrapper retires the legacy credits field on any successful account activity", async () => {
  const source = await read("../../cloudflare/src/account-directory.ts");

  assert.match(source, /class UserDirectory extends WorkerUserDirectory/,
               "the existing Durable Object class and migration remain in use");
  assert.match(source, /if \(response\.ok && \(request\.method === "GET" \|\| request\.method === "POST"\)\) \{\s*await this\.ctx\.storage\.delete\("credits"\)/,
               "profile reads/writes and successful usage writes all clean old stored balances");
  assert.match(source, /delete body\.credits/,
               "root account responses never return the retired field");
  assert.match(source, /headers\.delete\("Content-Length"\)/,
               "rewritten account JSON cannot reuse a stale byte length");
});

test("OAuth profile presentation metadata cannot inject control or bidi formatting", async () => {
  const source = await read("../../cloudflare/src/account-directory.ts");

  assert.match(source,
    /const UNSAFE_PROFILE_FORMAT = \/\[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069\]\/g/,
    "C0/C1 controls and Unicode bidi override/isolate controls are removed from stored presentation metadata");
  assert.match(source, /private async sanitizeProviderProfile\(request: Request\): Promise<Request>/);
  assert.match(source, /let email = cleanProfileText\(data\.email, 160\)/);
  assert.match(source, /let name = cleanProfileText\(data\.name, 80\)/);
  assert.match(source, /if \(!name\) name = cleanProfileText\(email, 80\)/,
               "a missing display name may fall back only to sanitized email metadata");
  assert.match(source, /const sanitized = await this\.sanitizeProviderProfile\(request\);\s*const forwarded = await this\.preserveAppleProfileName\(sanitized\)/,
               "all OAuth profile writes are sanitized before provider-specific preservation logic");
  assert.doesNotMatch(source, /data\.user_id\s*=/,
                      "presentation sanitization never rewrites the subject-derived account identifier");
});

test("logout revocation and deletion generation retain only bounded opaque session state", async () => {
  const directory = await read("../../cloudflare/src/account-directory.ts");
  const guard = await read("../../cloudflare/src/account-guard-entry.ts");
  const issuance = await read("../../cloudflare/src/session-issuance-entry.ts");
  const sessions = await read("../../cloudflare/src/session-v2.ts");

  assert.match(directory, /const SESSION_REVOCATION_PREFIX = "session-revoked:"/);
  assert.match(directory, /const SESSION_ISSUANCE_PREFIX = "session-issued:"/);
  assert.match(directory, /const ACCOUNT_DELETION_KEY = "account-deletion:v1"/);
  assert.match(directory, /const SESSION_REVOCATION_MAX_MS = 31 \* 24 \* 60 \* 60 \* 1000/,
               "malformed future session state cannot create unbounded account retention");
  assert.match(directory, /Object\.keys\(data\)\.sort\(\)\.join\(","\) !== "digest,expires_at"/,
               "internal session writes accept only the digest and original expiry");
  assert.match(directory, /SESSION_REVOCATION_PATTERN = \/\^\[A-Za-z0-9_-\]\{43\}\$\//,
               "session state contains a SHA-256-sized opaque digest, never a raw session token");
  assert.match(directory, /validSessionExpiry\(marker\.expiresAt, now\)/,
               "revocation and issuance records expire with the credential they govern");
  assert.match(directory, /await this\.ctx\.storage\.put\(ACCOUNT_DELETION_KEY, \{deletedAt, expiresAt\}\)/,
               "account deletion preserves only a bounded non-identifying generation tombstone");
  assert.match(directory, /issuance\.issuedAt <= deletion\.deletedAt/,
               "a session must have a post-deletion issuance record before it can survive account recreation");
  assert.match(directory, /await this\.moveAlarmEarlier\(Math\.min\(\.\.\.expiries\)\)/,
               "session cleanup may move the shared alarm earlier but never extend base retention");
  assert.match(directory, /async alarm\(\): Promise<void> \{\s*await super\.alarm\(\);\s*await this\.pruneDeliveryMarkers\(\);\s*await this\.pruneSessionRevocations\(\)/,
               "usage retention, delivery dedupe, and session state share one ordered alarm lifecycle");

  assert.match(sessions, /async function tokenDigest\(token: string\): Promise<string>/);
  assert.match(sessions, /crypto\.subtle\.digest\("SHA-256", new TextEncoder\(\)\.encode\(token\)\)/,
               "the shared verifier hashes the exact external bearer before account storage");
  assert.match(sessions, /SESSION_V2_PURPOSE = "session\.v2"/);
  assert.match(sessions, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/,
               "new sessions contain independent 128-bit issuance entropy");
  assert.match(issuance, /registerSessionIssuance\(identity: SessionIdentity, env: Env\)/,
               "external s2 issuance is durably registered before a bearer is returned");
  assert.match(issuance, /if \(!identity \|\| identity\.version !== 2 \|\| !await registerSessionIssuance\(identity, env\)\)/,
               "browser callback issuance fails closed when its generation record cannot be stored");
  assert.match(guard, /const identity = await sessionIdentity\(request, env\)/,
               "the outer account boundary authenticates the external token before legacy adaptation");
  assert.match(guard, /return launchEntry\.fetch\(withLegacySession\(request, identity\), env, ctx\)/,
               "only a verified token is translated to the legacy internal representation");
  assert.match(guard, /if \(!sessionMutationOriginAllowed\(request, env\)\) return launchEntry\.fetch/,
               "cross-origin logout cannot create a revocation side effect");
  assert.match(guard, /await revokeSession\(identity, env\)/,
               "logout records server revocation before local credential clearing");
  assert.match(guard, /if \(await sessionRevoked\(identity, env\)\) return staleSessionResponse\(request\)/,
               "revoked or pre-deletion sessions cannot create rooms or delete the account");
});

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

test("logout revocation stores only an expiring token digest and shares the account retention alarm safely", async () => {
  const directory = await read("../../cloudflare/src/account-directory.ts");
  const guard = await read("../../cloudflare/src/account-guard-entry.ts");

  assert.match(directory, /const SESSION_REVOCATION_PREFIX = "session-revoked:"/);
  assert.match(directory, /const SESSION_REVOCATION_MAX_MS = 31 \* 24 \* 60 \* 60 \* 1000/,
               "malformed future revocations cannot create unbounded account retention");
  assert.match(directory, /Object\.keys\(data\)\.sort\(\)\.join\(","\) !== "digest,expires_at"/,
               "the internal revocation write accepts only the digest and original expiry");
  assert.match(directory, /SESSION_REVOCATION_PATTERN = \/\^\[A-Za-z0-9_-\]\{43\}\$\//,
               "revocation storage contains a SHA-256-sized opaque digest, never a raw session token");
  assert.match(directory, /marker\.expiresAt \* 1000 <= now/,
               "revocations expire with the credential they block");
  assert.match(directory, /await this\.moveAlarmEarlier\(earliest\)/,
               "revocation cleanup may move the shared alarm earlier but never extend base retention");
  assert.match(directory, /async alarm\(\): Promise<void> \{\s*await super\.alarm\(\);\s*await this\.pruneDeliveryMarkers\(\);\s*await this\.pruneSessionRevocations\(\)/,
               "usage retention, delivery dedupe, and session revocation share one ordered alarm lifecycle");

  assert.match(guard, /crypto\.subtle\.digest\("SHA-256", new TextEncoder\(\)\.encode\(token\)\)/,
               "the edge hashes the bearer before it reaches account storage");
  assert.match(guard, /if \(!sessionMutationOriginAllowed\(request, env\)\) return launchEntry\.fetch/,
               "cross-origin logout cannot create a revocation side effect");
  assert.match(guard, /await revokeSession\(identity, env\)/,
               "logout records server revocation before local credential clearing");
  assert.match(guard, /if \(await sessionRevoked\(identity, env\)\) return staleSessionResponse\(request\)/,
               "revoked sessions cannot create rooms or delete the account");
});

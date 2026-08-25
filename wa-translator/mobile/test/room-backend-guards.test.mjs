import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("production room wrapper bounds compute handshakes without lengthening shorter callers", async () => {
  const source = await read("../../cloudflare/src/two-party-room.ts");

  assert.match(source, /const COMPUTE_FETCH_TIMEOUT_MS = 30_000/);
  assert.match(source, /private computeFetch\(request: Request\): Promise<Response>/,
               "the runtime-dispatched base compute seam is overridden once at the wrapper");
  assert.match(source, /AbortSignal\.any\(\[\s*request\.signal,\s*AbortSignal\.timeout\(COMPUTE_FETCH_TIMEOUT_MS\)/,
               "an existing shorter request timeout wins while an unbounded handshake gets a ceiling");
  assert.match(source, /this\.env\.MODAL_TEST \? this\.env\.MODAL_TEST\.fetch\(bounded\) : fetch\(bounded\)/,
               "test and live compute use the same bounded request");
});

test("the same wrapper remains the two-person admission authority without counting expired leases", async () => {
  const source = await read("../../cloudflare/src/two-party-room.ts");
  assert.match(source, /export const PARTICIPANT_LIMIT = 2/);
  assert.match(source, /const PRESENCE_LEASE_MS = 90_000/,
               "the early wrapper check uses the same lease duration as the base room");
  assert.match(source, /private joinedCount\(now = Date\.now\(\)\): number/);
  assert.match(source, /value\?\.joined === true[\s\S]*?Number\.isFinite\(value\.lastSeenAt\)[\s\S]*?now - value\.lastSeenAt < PRESENCE_LEASE_MS/,
               "expired joined sockets pass through to WorkerRoom so its sweep can evict them before admission");
  assert.match(source, /this\.joinedCount\(\) >= PARTICIPANT_LIMIT/);
  assert.match(source, /socket\.close\(1013, "room full"\)/);
});

test("room usage survives transient account delivery failures without duplicating concurrent flushes", async () => {
  const source = await read("../../cloudflare/src/two-party-room.ts");

  assert.match(source, /const USAGE_PENDING_KEY = "usagePendingV1"/);
  assert.match(source, /private usageFlush: Promise<void> \| null = null/);
  assert.match(source, /if \(this\.usageFlush\) return this\.usageFlush/,
               "last-peer and host-close flushes share one live delivery operation");
  assert.match(source, /this\.ctx\.storage\.transaction\(async transaction => \{[\s\S]*?transaction\.put\(USAGE_PENDING_KEY, \{\.\.\.active\}\)[\s\S]*?transaction\.put\("usage", \{\.\.\.EMPTY_USAGE\}\)/,
               "active counters are durably moved to a pending snapshot before any network delivery");
  assert.match(source, /catch \{\s*return; \/\/ pending storage remains intact for the next close\/expiry flush/,
               "a thrown account delivery leaves the pending snapshot untouched");
  assert.match(source, /if \(status < 200 \|\| status >= 300\) return/,
               "ordinary non-success responses also retain the pending snapshot");
  assert.match(source, /if \(status === 404\) \{[\s\S]*?transaction\.delete\(USAGE_PENDING_KEY\)[\s\S]*?transaction\.put\("usage", \{\.\.\.EMPTY_USAGE\}\)/,
               "authoritative account deletion drops both backlog and later counters instead of resurrecting usage");
  assert.match(source, /for \(let pass = 0; pass < 2; pass\+\+\)/,
               "one flush can drain an older backlog and the active counters accumulated behind it without an unbounded loop");
  assert.match(source, /if \(!snapshot\.wasPending\) return/,
               "a fresh snapshot is delivered once and does not chase a newly active room");
});

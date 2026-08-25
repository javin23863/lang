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

test("the same wrapper remains the two-person admission authority", async () => {
  const source = await read("../../cloudflare/src/two-party-room.ts");
  assert.match(source, /export const PARTICIPANT_LIMIT = 2/);
  assert.match(source, /this\.joinedCount\(\) >= PARTICIPANT_LIMIT/);
  assert.match(source, /socket\.close\(1013, "room full"\)/);
});

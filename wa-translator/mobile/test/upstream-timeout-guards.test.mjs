import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("shipping Worker entrypoint bounds external dependency waits", async () => {
  const source = await read("../../cloudflare/src/launch-entry.ts");

  assert.match(source, /const MODAL_UPSTREAM_TIMEOUT_MS = 30_000/);
  assert.match(source, /const TURN_UPSTREAM_TIMEOUT_MS = 10_000/);
  assert.match(source, /const OAUTH_UPSTREAM_TIMEOUT_MS = 20_000/);
  assert.match(source, /AbortSignal\.any\(\[\s*request\.signal,\s*AbortSignal\.timeout\(timeoutMs\)/,
               "a shorter existing caller cancellation is preserved while every external request gets a ceiling");
  assert.match(source, /return new Response\("Upstream unavailable", \{\s*status: 504/,
               "timeout/network failures become ordinary non-success upstream responses");
  assert.match(source, /MODAL_TEST: boundedFetcher\(env\.MODAL_TEST, MODAL_UPSTREAM_TIMEOUT_MS\)/);
  assert.match(source, /TURN_TEST: boundedFetcher\(env\.TURN_TEST, TURN_UPSTREAM_TIMEOUT_MS\)/);
  assert.match(source, /OAUTH_TEST: boundedFetcher\(env\.OAUTH_TEST, OAUTH_UPSTREAM_TIMEOUT_MS\)/);
  assert.match(source, /mobileEntry\.fetch\(\s*request, boundedUpstreamEnv\(env\), ctx\s*\)/,
               "all top-level Worker routes receive the bounded dependency view");
});

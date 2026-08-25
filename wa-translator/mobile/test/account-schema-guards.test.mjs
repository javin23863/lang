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

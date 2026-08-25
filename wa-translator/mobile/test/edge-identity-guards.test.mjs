import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("shipping abuse quotas key and domain-separate edge IP identity before storage", async () => {
  const source = await read("../../cloudflare/src/launch-entry.ts");

  assert.match(source, /const ABUSE_IP_PURPOSE = "abuse-ip\.v1"/);
  assert.match(source, /const ip = request\.headers\.get\("CF-Connecting-IP"\)/);
  assert.match(source, /crypto\.subtle\.importKey\([\s\S]*?\{name: "HMAC", hash: "SHA-256"\}/,
               "the edge identity is keyed rather than directly hashed");
  assert.match(source, /new TextEncoder\(\)\.encode\(`\$\{ABUSE_IP_PURPOSE\}\\0\$\{ip\}`\)/,
               "the same signing key is domain-separated from room/session token uses");
  assert.match(source, /headers\.set\("CF-Connecting-IP", `p1\.\$\{base64url\(digest\)\}`\)/,
               "only the keyed pseudonym is forwarded to the base quota implementation");
  assert.match(source, /const routedRequest = await pseudonymizeEdgeIp\(request, boundedEnv\)/);
  assert.match(source, /mobileEntry\.fetch\(routedRequest, boundedEnv, ctx\)/,
               "all shipping routes use the pseudonymized request view");
});

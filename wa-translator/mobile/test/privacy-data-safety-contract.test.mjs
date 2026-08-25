import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("store privacy declarations cover retained quota identity and ephemeral live content", async () => {
  const [worker, privacy, declarations, manifest] = await Promise.all([
    read("../../cloudflare/src/worker.ts"),
    read("../../windows/static/privacy.html"),
    read("../STORE-DECLARATIONS.md"),
    read("../ios/App/App/PrivacyInfo.xcprivacy"),
  ]);

  assert.match(worker, /request\.headers\.get\("CF-Connecting-IP"\)/,
    "rate limiting is keyed from the edge-provided network source");
  assert.match(worker, /crypto\.subtle\.digest\(\s*"SHA-256", new TextEncoder\(\)\.encode\(ip\)/,
    "the raw source IP is reduced to a SHA-256 digest before quota routing");
  assert.match(worker, /idFromName\(`\$\{action\}:\$\{digest\}`\)/,
    "the digest is used only as the abuse-quota object identity");
  assert.match(worker, /await this\.ctx\.storage\.setAlarm\(current\.windowStart \+ windowMs\)/);
  assert.match(worker, /async alarm\(\): Promise<void> \{\s*await this\.ctx\.storage\.deleteAll\(\)/,
    "quota counters are removed automatically at the end of their bounded window");

  assert.match(manifest, /NSPrivacyCollectedDataTypeOtherDataTypes/,
    "Apple privacy metadata covers the retained IP-derived quota identity");
  assert.match(manifest,
    /NSPrivacyCollectedDataTypeOtherDataTypes<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<false\/>/,
    "the quota identity is not linked to the signed-in account");

  for (const phrase of [
    "Google Play Data Safety",
    "Voice or sound recordings",
    "Other in-app messages",
    "Device or other IDs",
    "processed ephemerally",
    "Fraud prevention, security, and compliance",
  ]) assert.ok(declarations.includes(phrase), `store declarations include ${phrase}`);

  assert.match(privacy, /providers enabled for that release/i,
    "the public policy describes the configured OAuth set rather than promising Facebook");
  assert.doesNotMatch(privacy, /sign-in is handled by Google, Apple, or Facebook/i);
  assert.match(privacy, /SHA-256 digest of the Cloudflare-provided source IP/i,
    "the public policy discloses the short-lived abuse-prevention identifier");
  assert.match(privacy, /no longer than 24 hours/i,
    "the public policy states the quota retention ceiling");
});

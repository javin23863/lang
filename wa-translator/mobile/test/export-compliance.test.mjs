import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("iOS export-compliance declaration stays explicit and packaged-artifact verified", async () => {
  const info = await read("../ios/App/App/Info.plist");
  const verifier = await read("../scripts/verify-ios-app.sh");
  const declarations = await read("../STORE-DECLARATIONS.md");

  assert.match(
    info,
    /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/,
    "the app must explicitly declare that it does not use non-exempt encryption",
  );
  assert.match(verifier, /plist_value ITSAppUsesNonExemptEncryption/);
  assert.match(verifier, /iOS app must declare non-exempt encryption disabled/);
  assert.match(declarations, /Encryption declaration: HTTPS\/WebSocket TLS and platform cryptography only/);
  assert.match(declarations, /review Apple export-compliance answers before submission/);
});

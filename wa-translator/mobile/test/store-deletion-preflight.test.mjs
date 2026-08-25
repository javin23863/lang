import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("signed store preflight verifies the external account deletion resource", async () => {
  const source = await read("../scripts/store-preflight.mjs");

  assert.match(source, /const path = "\/delete-account\.html"/,
               "Play's account-deletion URL is a dedicated production resource");
  assert.match(source, /Delete your Lingua Relay account/i,
               "the preflight requires the deletion page to identify the product and purpose");
  assert.match(source, /do not need the mobile app/i,
               "the external deletion path must remain usable after uninstall");
  assert.match(source, /Open Lingua Relay account controls/i,
               "the public page must lead into the browser deletion pathway");
  assert.match(source, /legalSurface\("\/privacy"\)[\s\S]*legalSurface\("\/terms"\)[\s\S]*legalSurface\("\/support"\)[\s\S]*deletionSurface\(\)/,
               "every signed beta upload checks privacy, terms, support, and deletion together");
  assert.match(source, /redirect: "error"/,
               "store preflight does not silently accept a redirected or replaced deletion resource");
});

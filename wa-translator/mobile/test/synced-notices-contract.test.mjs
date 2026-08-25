import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("native sync verifies generated third-party notices on both platforms", async () => {
  const packageJson = JSON.parse(await read("../package.json"));
  const verifier = await read("../scripts/verify-synced-notices.mjs");

  assert.match(packageJson.scripts.sync, /verify-synced-notices\.mjs/,
               "native sync must fail if generated notices do not reach platform projects");
  assert.match(verifier, /android.*app.*src.*main.*assets.*public.*third-party-notices\.txt/s);
  assert.match(verifier, /ios.*App.*App.*public.*third-party-notices\.txt/s);
  assert.match(verifier, /@capacitor\/core@8\.5\.0/);
  assert.match(verifier, /@aparajita\/capacitor-secure-storage@8\.0\.0/);
});

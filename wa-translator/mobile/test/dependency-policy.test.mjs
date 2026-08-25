import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

async function projectPolicy(packagePath, npmrcPath) {
  const pkg = JSON.parse(await read(packagePath));
  const npmrc = await read(npmrcPath);
  assert.match(npmrc, /^strict-allow-scripts=true\s*$/m,
               `${npmrcPath} must fail installs on unreviewed dependency scripts`);
  assert.ok(pkg.allowScripts && typeof pkg.allowScripts === "object",
            `${packagePath} records reviewed install scripts`);
  return pkg.allowScripts;
}

test("dependency install scripts are explicit and version-pinned", async () => {
  const mobile = await projectPolicy("../package.json", "../.npmrc");
  assert.deepEqual(mobile, {"esbuild@0.28.2": true});

  const worker = await projectPolicy("../../cloudflare/package.json", "../../cloudflare/.npmrc");
  assert.deepEqual(worker, {
    "esbuild@0.28.1": true,
    "fsevents@2.3.3": true,
    "workerd@1.20260811.1": true,
  });

  for (const policy of [mobile, worker]) {
    for (const [name, allowed] of Object.entries(policy)) {
      assert.equal(allowed, true, `${name} is explicitly approved`);
      assert.match(name, /@\d/, `${name} approval is pinned to a version`);
    }
  }
});

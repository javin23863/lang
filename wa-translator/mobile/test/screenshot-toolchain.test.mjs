import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");

test("store screenshot Python dependency is exact, isolated, and self-bootstrapping", async () => {
  const [requirements, runner, packageText, gitignore] = await Promise.all([
    read("../requirements-screenshots.txt"),
    read("../scripts/run-store-screenshot-tool.py"),
    read("../package.json"),
    read("../../../.gitignore"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(requirements.trim(), "Pillow==12.3.0");
  assert.match(runner, /VENV = ROOT \/ "\.venv-screenshots"/);
  assert.match(runner, /venv\.EnvBuilder\(with_pip=True\)\.create\(VENV\)/);
  assert.match(runner, /Python 3\.10 or newer is required/);
  assert.match(runner, /def expected_pillow_version\(\)/);
  assert.match(runner, /re\.fullmatch\(r"Pillow==/);
  assert.match(runner, /import PIL; print\(PIL\.__version__\)/);
  assert.match(runner, /"--only-binary=:all:"/);
  assert.match(runner, /"--no-deps"/);
  assert.match(runner, /run_script\(python, "promote-browser-screenshots\.py"\)/);
  assert.match(runner, /run_script\(python, "prepare-store-screenshots\.py"\)/);

  assert.equal(
    packageJson.scripts.screenshots,
    "python scripts/run-store-screenshot-tool.py prepare",
  );
  assert.equal(
    packageJson.scripts["screenshots:refresh"],
    "python scripts/run-store-screenshot-tool.py refresh",
  );
  assert.match(gitignore, /wa-translator\/mobile\/\.venv-screenshots\//);
});

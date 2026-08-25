import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("deployment credentials and local secret files stay out of git", async () => {
  const root = await read("../../../.gitignore");
  const mobile = await read("../.gitignore");

  for (const pattern of [
    ".env", ".dev.vars", "*.p8", "*.p12", "*.mobileprovision",
    "*.jks", "*.keystore", "**/google-services.json", "**/google-play.json",
  ]) assert.ok(root.includes(pattern), `root .gitignore covers ${pattern}`);

  for (const pattern of [
    "*.p8", "*.p12", "*.mobileprovision", "*.jks", "*.keystore",
    "google-play.json", "android/app/google-services.json",
  ]) assert.ok(mobile.includes(pattern), `mobile .gitignore covers ${pattern}`);

  assert.match(root, /!\.env\.example/,
               "a sanitized environment template may still be committed intentionally");
});

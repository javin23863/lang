import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const verifier = await readFile(path.join(packageRoot, "scripts", "verify-deployment-workflows.mjs"), "utf8");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));

describe("staging deployment verification", () => {
  it("runs the real repository workflow verifier before the Workerd test pool", () => {
    expect(packageJson.scripts.check).toContain("node scripts/verify-deployment-workflows.mjs");
    for (const marker of [
      "cloudflare-staging.yml",
      "release_sha:",
      "environment: cloudflare-staging",
      "wrangler.staging.jsonc",
      "spoken-translation-room-staging.spoken-translation-cloudflare.workers.dev",
    ]) expect(verifier).toContain(marker);
  });
});

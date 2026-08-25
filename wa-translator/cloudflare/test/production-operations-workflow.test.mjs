import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const verifier = await readFile(path.join(packageRoot, "scripts", "verify-deployment-workflows.mjs"), "utf8");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));

describe("production Worker operations verification", () => {
  it("runs the real repository workflow verifier before the Workerd test pool", () => {
    expect(packageJson.scripts.check).toContain("node scripts/verify-deployment-workflows.mjs");
    for (const marker of [
      "cloudflare-production.yml",
      "cloudflare-production-rollback.yml",
      "DEPLOY_PRODUCTION",
      "ROLLBACK_PRODUCTION",
      "environment: cloudflare-production",
      "CLOUDFLARE-OPERATIONS.md",
      "Authorization: Bearer ",
    ]) expect(verifier).toContain(marker);
  });
});

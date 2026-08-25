import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const production = await readFile(
  path.join(repoRoot, ".github", "workflows", "cloudflare-production.yml"), "utf8"
);
const rollback = await readFile(
  path.join(repoRoot, ".github", "workflows", "cloudflare-production-rollback.yml"), "utf8"
);
const runbook = await readFile(path.join(repoRoot, "wa-translator", "CLOUDFLARE-OPERATIONS.md"), "utf8");

describe("production Worker operations", () => {
  it("keeps production deployment deliberate, exact-SHA-bound, and smoke-gated", () => {
    expect(production).toContain("workflow_dispatch:");
    expect(production).not.toMatch(/^\s*pull_request:/m);
    expect(production).not.toMatch(/^\s*push:/m);
    expect(production).toContain("environment: cloudflare-production");
    expect(production).toContain("release_sha:");
    expect(production).toContain("confirm:");
    expect(production).toContain('"$CONFIRM" != "DEPLOY_PRODUCTION"');
    expect(production).toContain('[[ ! "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(production).toContain('"$DISPATCH_RELEASE_SHA" != "$EXPECTED_RELEASE_SHA"');
    expect(production).toContain("npx wrangler deploy -c wrangler.jsonc");
    expect(production).toContain("npm run smoke:deployment");
    expect(production).toContain("spoken-translation-room.spoken-translation-cloudflare.workers.dev");
    expect(production).toContain("npx wrangler deployments list -c wrangler.jsonc");
  });

  it("makes rollback an explicit version-targeted production operation", () => {
    expect(rollback).toContain("workflow_dispatch:");
    expect(rollback).not.toMatch(/^\s*pull_request:/m);
    expect(rollback).not.toMatch(/^\s*push:/m);
    expect(rollback).toContain("environment: cloudflare-production");
    expect(rollback).toContain("version_id:");
    expect(rollback).toContain('"$CONFIRM" != "ROLLBACK_PRODUCTION"');
    expect(rollback).toContain('npx wrangler rollback "$VERSION_ID"');
    expect(rollback).toContain('--message "operator rollback via GitHub Actions"');
    expect(rollback).toContain("npm run smoke:deployment");
  });

  it("documents immutable receipts and rollback safety without capability data", () => {
    expect(runbook).toContain("exact source SHA");
    expect(runbook).toContain("Worker deployment/version ID");
    expect(runbook).toContain("npx wrangler versions list --name spoken-translation-room --json");
    expect(runbook).toContain("Do not roll back blindly across a Durable Object class lifecycle or binding migration");
    for (const forbidden of ["paste your token", "room bearer value", "Authorization: Bearer "]) {
      expect(runbook).not.toContain(forbidden);
    }
  });
});

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const workflow = await readFile(path.join(repoRoot, ".github", "workflows", "cloudflare-staging.yml"), "utf8");
const packageJson = JSON.parse(await readFile(path.resolve(here, "..", "package.json"), "utf8"));
const smoke = await readFile(path.resolve(here, "..", "scripts", "smoke-deployment.mjs"), "utf8");

describe("staging deployment acceptance lane", () => {
  it("is deliberate, exact-SHA-bound, isolated from production, and smoke-tested", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s*pull_request:/m);
    expect(workflow).not.toMatch(/^\s*push:/m);
    expect(workflow).toContain("release_sha:");
    expect(workflow).toContain('[[ ! "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(workflow).toContain('"$DISPATCH_RELEASE_SHA" != "$EXPECTED_RELEASE_SHA"');
    expect(workflow).toContain("environment: cloudflare-staging");
    expect(workflow).toContain("wrangler deploy -c wrangler.staging.jsonc");
    expect(workflow).not.toMatch(/wrangler deploy(?:\s|$)(?![^\n]*wrangler\.staging\.jsonc)/);
    expect(workflow).toContain("CLOUDFLARE_API_TOKEN");
    expect(workflow).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(workflow).toContain("spoken-translation-room-staging.spoken-translation-cloudflare.workers.dev");
    expect(workflow).toContain("npm run smoke:deployment");
  });

  it("keeps the live smoke contract credential-free and capability-safe", () => {
    expect(packageJson.scripts["smoke:deployment"]).toBe("node scripts/smoke-deployment.mjs");
    expect(smoke).toContain('"/health"');
    expect(smoke).toContain('"/api/v1/mobile/bootstrap"');
    expect(smoke).toContain('contract?.protocol === 2');
    expect(smoke).toContain('contract?.max_room_participants === 2');
    expect(smoke).toContain('contract?.account_mode === "session"');
    expect(smoke).toContain('contract?.call_lifecycle === "foreground"');
    expect(smoke).toContain('redirect: "error"');
    expect(smoke).not.toContain("Authorization");
    expect(smoke).not.toContain("host_control");
    expect(smoke).not.toContain("roomToken");
  });
});

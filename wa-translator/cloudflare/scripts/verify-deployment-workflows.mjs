#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const workflowDir = path.join(repoRoot, ".github", "workflows");

function requireText(source, marker, label) {
  if (!source.includes(marker)) throw new Error(`${label} is missing required marker: ${marker}`);
}

function forbidPattern(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`${label} contains forbidden trigger or command: ${pattern}`);
}

const [staging, production, rollback, runbook] = await Promise.all([
  readFile(path.join(workflowDir, "cloudflare-staging.yml"), "utf8"),
  readFile(path.join(workflowDir, "cloudflare-production.yml"), "utf8"),
  readFile(path.join(workflowDir, "cloudflare-production-rollback.yml"), "utf8"),
  readFile(path.join(repoRoot, "wa-translator", "CLOUDFLARE-OPERATIONS.md"), "utf8"),
]);

for (const [label, workflow] of [["staging", staging], ["production", production], ["rollback", rollback]]) {
  requireText(workflow, "workflow_dispatch:", label);
  forbidPattern(workflow, /^\s*pull_request:/m, label);
  forbidPattern(workflow, /^\s*push:/m, label);
  requireText(workflow, "persist-credentials: false", label);
  requireText(workflow, "CLOUDFLARE_API_TOKEN", label);
  requireText(workflow, "CLOUDFLARE_ACCOUNT_ID", label);
  requireText(workflow, "npm run smoke:deployment", label);
}

for (const marker of [
  "release_sha:",
  '[[ ! "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]',
  '"$DISPATCH_RELEASE_SHA" != "$EXPECTED_RELEASE_SHA"',
  "environment: cloudflare-staging",
  "npx wrangler deploy -c wrangler.staging.jsonc",
  "spoken-translation-room-staging.spoken-translation-cloudflare.workers.dev",
]) requireText(staging, marker, "staging");
forbidPattern(staging, /wrangler deploy(?:\s|$)(?![^\n]*wrangler\.staging\.jsonc)/, "staging");

for (const marker of [
  "release_sha:",
  "confirm:",
  '"$CONFIRM" != "DEPLOY_PRODUCTION"',
  '[[ ! "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]',
  '"$DISPATCH_RELEASE_SHA" != "$EXPECTED_RELEASE_SHA"',
  "environment: cloudflare-production",
  "npx wrangler deploy -c wrangler.jsonc",
  "spoken-translation-room.spoken-translation-cloudflare.workers.dev",
  "npx wrangler deployments list -c wrangler.jsonc",
]) requireText(production, marker, "production");

for (const marker of [
  "version_id:",
  "confirm:",
  '"$CONFIRM" != "ROLLBACK_PRODUCTION"',
  "environment: cloudflare-production",
  'npx wrangler rollback "$VERSION_ID"',
  '--message "operator rollback via GitHub Actions"',
  "spoken-translation-room.spoken-translation-cloudflare.workers.dev",
]) requireText(rollback, marker, "rollback");

for (const marker of [
  "exact source SHA",
  "Worker deployment/version ID",
  "npx wrangler versions list --name spoken-translation-room --json",
  "Do not roll back blindly across a Durable Object class lifecycle or binding migration",
]) requireText(runbook, marker, "operations runbook");
for (const forbidden of ["paste your token", "room bearer value", "Authorization: Bearer "]) {
  if (runbook.includes(forbidden)) throw new Error(`operations runbook contains forbidden capability guidance: ${forbidden}`);
}

console.log("Deployment workflow check: staging, production, rollback, immutable SHA gates, smoke checks, and capability-safe runbook are pinned.");

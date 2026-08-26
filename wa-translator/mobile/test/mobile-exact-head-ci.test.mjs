import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/mobile-build.yml", import.meta.url);

async function workflowSource() {
  return readFile(workflowUrl, "utf8");
}

test("prelaunch pushes run the credential-free matrix on the literal pushed SHA", async () => {
  const workflow = await workflowSource();

  assert.match(
    workflow,
    /push:\s*\n\s*branches:\s*\n\s*- main\s*\n\s*- "prelaunch\/\*\*"/,
    "prelaunch branches must have a push-event release matrix independent of the PR merge ref",
  );

  const exactShaCheckouts = workflow.match(/ref: \$\{\{ github\.sha \}\}/g) ?? [];
  assert.equal(
    exactShaCheckouts.length,
    3,
    "product-regression, Android, and iOS must all checkout the event SHA",
  );

  assert.match(
    workflow,
    /workflow_dispatch:[\s\S]*release_sha:[\s\S]*Exact 40-character commit SHA approved for release verification/,
    "manual frozen-SHA verification must remain available for final release acceptance",
  );
});

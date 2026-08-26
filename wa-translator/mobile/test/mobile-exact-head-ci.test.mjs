import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/mobile-build.yml", import.meta.url);
const checklistUrl = new URL("../LAUNCH-CHECKLIST.md", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("prelaunch pushes run the credential-free matrix on the literal pushed SHA", async () => {
  const [workflow, checklist] = await Promise.all([
    source(workflowUrl),
    source(checklistUrl),
  ]);

  assert.match(
    workflow,
    /push:\s*\n\s*branches:\s*\n\s*- main\s*\n\s*- "prelaunch\/\*\*"/,
    "prelaunch branches must have a push-event release matrix independent of the PR merge ref",
  );

  for (const evidencePath of [
    '"wa-translator/tools/browser/**"',
    '".github/workflows/mobile-native-smoke.yml"',
  ]) {
    assert.equal(
      workflow.split(evidencePath).length - 1,
      2,
      `${evidencePath} must trigger both PR diagnostics and exact-head prelaunch push checks`,
    );
  }

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

  assert.match(
    checklist,
    /PR GitHub Actions[\s\S]*do \*\*not\*\* satisfy release acceptance[\s\S]*synthetic merge ref/,
    "the launch source of truth must keep PR merge-ref checks diagnostic-only",
  );
  assert.match(
    checklist,
    /Prelaunch branch push runs execute the same[\s\S]*literal pushed SHA[\s\S]*intermediate\s+exact-head source acceptance/,
    "the launch source of truth must identify the push-event lane as exact-head evidence",
  );
});

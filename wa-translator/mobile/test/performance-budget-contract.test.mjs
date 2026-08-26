import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const budgetSource = await readFile(new URL("../scripts/check-web-budgets.mjs", import.meta.url), "utf8");
const bridgeBuildSource = await readFile(new URL("../scripts/build-bridge.mjs", import.meta.url), "utf8");

test("mobile checks enforce deterministic web performance budgets", () => {
  assert.equal(packageJson.scripts["check:web-budgets"], "node scripts/check-web-budgets.mjs");
  assert.equal(packageJson.scripts["build:bridge"], "node scripts/build-bridge.mjs");
  assert.match(bridgeBuildSource, /bundle:\s*true/);
  assert.match(bridgeBuildSource, /minify:\s*true/);
  assert.match(packageJson.scripts.check, /npm run build:web && npm run check:web-budgets/);

  for (const marker of [
    "dashboardJs: 160 * KiB",
    "dashboardCss: 16 * KiB",
    "mobileBridge: 64 * KiB",
    "roomJs: 96 * KiB",
    "roomCss: 32 * KiB",
    "dashboardHtml: 24 * KiB",
    '"dashboard-onboarding.js"',
    '"dashboard-room-controller.js"',
    '"mobile-bridge.js"',
  ]) assert.ok(budgetSource.includes(marker), `web budget contract is missing ${marker}`);

  assert.match(budgetSource, /throw new Error\(`\$\{label\} exceeds budget/);
});

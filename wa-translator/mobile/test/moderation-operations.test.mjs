import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("moderation tooling keeps the admin secret out of argv and client code", async () => {
  const script = await read("../../cloudflare/scripts/moderate-reports.mjs");
  const packageJson = JSON.parse(await read("../../cloudflare/package.json"));
  const runbook = await read("../../cloudflare/MODERATION-RUNBOOK.md");

  assert.match(script, /const \[command, reportId, \.\.\.extra\] = process\.argv\.slice\(2\)/,
               "argv contains only the moderation action and report id");
  assert.match(script, /const token = String\(process\.env\.MOBILE_REPORT_ADMIN_TOKEN \|\| ""\)/,
               "the admin secret is loaded only from the operator environment");
  assert.match(script, /process\.env\.LINGUA_PUBLIC_ORIGIN/);
  assert.doesNotMatch(script, /const\s+token\s*=\s*.*process\.argv/);
  assert.match(script, /Authorization: `Bearer \$\{token\}`/);
  assert.match(script, /AbortSignal\.timeout\(10_000\)/);
  assert.match(script, /redirect: "error"/);
  assert.equal(packageJson.scripts["reports:list"], "node scripts/moderate-reports.mjs list");
  assert.equal(packageJson.scripts["reports:close"], "node scripts/moderate-reports.mjs close");
  assert.match(runbook, /does not\s+contain free text, names, participant links, messages, captions, audio, video,/i);
  assert.match(runbook, /target within\s+4 hours/i);
  assert.match(runbook, /monitored operator\/on-call owner/i);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared native dashboard centralizes deadlines and real result telemetry", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const api = await readFile(new URL("dashboard-api.js", root), "utf8");
  const dashboard = await readFile(new URL("dashboard.js", root), "utf8");
  const controller = await readFile(new URL("dashboard-room-controller.js", root), "utf8");

  const apiTag = html.indexOf('<script src="/dashboard-api.js"></script>');
  const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');
  assert.ok(apiTag >= 0 && dashboardTag > apiTag,
    "the deadline client must load before dashboard behavior");

  assert.match(api, /const REQUEST_TIMEOUT_MS = 15_000/);
  assert.match(api, /const controller = new AbortController\(\)/);
  assert.match(api, /setTimeout\(\(\) => controller\.abort\(\), REQUEST_TIMEOUT_MS\)/);
  assert.match(api, /clearTimeout\(timer\)/);
  assert.match(api, /Object\.defineProperty\(window, "LinguaDashboardApi"/);
  assert.doesNotMatch(api, /localStorage|sessionStorage/,
    "the API boundary carries no persistence or user state");

  assert.match(dashboard, /const dashboardFetch = window\.LinguaDashboardApi\.fetch/);
  assert.doesNotMatch(dashboard, /new AbortController\(\)/,
    "dashboard features must reuse the shared deadline boundary");
  assert.match(controller,
    /emit\("room\.create\.result", \{mode: requestedMode, result: "success"\}\)/);
  assert.match(controller,
    /emit\("room\.create\.result", \{mode: requestedMode, result: "failure"\}\)/);
  assert.match(controller, /emit\("room\.close\.result", \{result: "success"\}\)/);
  assert.match(controller, /emit\("room\.close\.result", \{result: "failure"\}\)/);

  const resultLines = controller.split("\n").filter(line => line.includes(".result\""));
  for (const forbidden of ["host_control", "Authorization", "shareLink", "inviteUrl"]) {
    assert.ok(resultLines.every(line => !line.includes(forbidden)),
      `result telemetry must not carry ${forbidden}`);
  }
});

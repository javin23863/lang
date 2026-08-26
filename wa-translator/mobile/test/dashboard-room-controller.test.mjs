import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared native dashboard isolates room control and polling", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const controller = await readFile(new URL("dashboard-room-controller.js", root), "utf8");
  const dashboard = await readFile(new URL("dashboard.js", root), "utf8");

  const controllerTag = html.indexOf('<script src="/dashboard-room-controller.js"></script>');
  const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');
  assert.ok(controllerTag >= 0 && dashboardTag > controllerTag,
    "room controller loads before dashboard orchestration");

  assert.match(dashboard, /window\.LinguaDashboardRoomController\.create/);
  assert.match(dashboard, /roomController\.create\("video"\)/);
  assert.match(dashboard, /roomController\.open/);
  assert.match(dashboard, /roomController\.close\(true\)/);
  assert.match(dashboard, /await roomController\.restore\(\)/);
  assert.doesNotMatch(dashboard, /\/api\/room-control/,
    "room control endpoints belong to the controller boundary");

  assert.match(controller, /const POLL_INTERVAL_MS = 15_000/);
  assert.match(controller, /let statusRefreshRoom = null/);
  assert.match(controller, /let invalidationGeneration = 0/);
  assert.match(controller, /const targetRoom = room/);
  assert.match(controller,
    /if \(!targetRoom \|\| busy \|\| statusRefreshRoom === targetRoom\) return/);
  assert.match(controller, /"Bearer " \+ targetRoom\.host_control/);
  assert.match(controller, /if \(room !== targetRoom\) return/);
  assert.match(controller,
    /catch \(_\) \{[\s\S]*?if \(room === targetRoom\)[\s\S]*?home\.statusUnavailable/);
  assert.match(controller,
    /if \(statusRefreshRoom === targetRoom\) statusRefreshRoom = null/);
  assert.match(controller, /dashboardFetch\(runtime\.apiUrl\("\/api\/rooms"\)/);
  assert.match(controller, /dashboardFetch\(runtime\.apiUrl\("\/api\/room-control"\)/);
  assert.match(controller, /dashboardFetch\(runtime\.apiUrl\("\/api\/room-control\/close"\)/);
  assert.match(controller, /value\.participant_limit !== 2/);
  assert.match(controller, /model\.normalizeMode\(mode\)/);
  assert.match(controller, /model\.save\(created\)/);
  assert.match(controller, /model\.load\(\)/);
  assert.match(controller, /model\.forget\(\)/);
  assert.match(controller, /runtime\.openRoom\(room\.path, model\.mode\(room\)\)/);

  assert.match(controller, /const targetGeneration = invalidationGeneration/);
  assert.match(controller, /invalidationGeneration !== targetGeneration/);
  assert.match(controller, /invalidationGeneration\+\+/);
  assert.match(controller,
    /async function discard\(\)[\s\S]*?invalidationGeneration\+\+[\s\S]*?room = null[\s\S]*?model\.forget\(\)/);
  assert.match(controller,
    /model\.save\(created\)[\s\S]*?invalidationGeneration !== targetGeneration[\s\S]*?model\.forget\(\)/,
    "a teardown that races persistence must remove the stale host control again");

  assert.match(controller,
    /emit\("room\.create\.result", \{mode: requestedMode, result: "success"\}\)/);
  assert.match(controller,
    /emit\("room\.create\.result", \{mode: requestedMode, result: "failure"\}\)/);
  assert.match(controller, /emit\("room\.close\.result", \{result: "success"\}\)/);
  assert.match(controller, /emit\("room\.close\.result", \{result: "failure"\}\)/);
});

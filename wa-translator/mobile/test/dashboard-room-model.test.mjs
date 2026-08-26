import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared native dashboard centralizes room capability and persistence rules", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const model = await readFile(new URL("dashboard-room-model.js", root), "utf8");
  const controller = await readFile(new URL("dashboard-room-controller.js", root), "utf8");
  const dashboard = await readFile(new URL("dashboard.js", root), "utf8");

  const modelTag = html.indexOf('<script src="/dashboard-room-model.js"></script>');
  const controllerTag = html.indexOf('<script src="/dashboard-room-controller.js"></script>');
  const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');
  assert.ok(modelTag >= 0 && controllerTag > modelTag && dashboardTag > controllerTag,
    "room model and controller load before dashboard orchestration");

  assert.match(dashboard, /window\.LinguaDashboardRoomModel\.create\(runtime\)/);
  assert.match(dashboard, /window\.LinguaDashboardRoomController\.create/);
  assert.match(dashboard, /model: roomModel/);
  assert.match(controller, /model\.valid\(created\)/);
  assert.match(controller, /model\.normalizeMode\(mode\)/);
  assert.match(controller, /model\.save\(created\)/);
  assert.match(controller, /model\.load\(\)/);
  assert.match(controller, /model\.forget\(\)/);

  assert.match(model, /const MODES = new Set\(\["voice", "chat", "video"\]\)/);
  assert.match(model, /return MODES\.has\(value\) \? value : "video"/);
  assert.match(model, /ROOM_PATH_PATTERN = \/\^\\\/room\\\//);
  assert.match(model, /HOST_CONTROL_PATTERN = \/\^hc1\\\./);
  assert.match(model, /const room = ROOM_PATH_PATTERN\.exec\(value\.path\)/);
  assert.match(model, /const control = HOST_CONTROL_PATTERN\.exec\(value\.host_control\)/);
  assert.match(model, /room\[1\] === control\[1\]/);
  assert.match(model, /room\[2\] === control\[2\]/);
  assert.match(model, /room\[2\] === expires/);
  assert.match(model, /if \(!valid\(room\)\) throw new TypeError\("invalid room capability"\)/);
  assert.match(model, /url\.searchParams\.set\("m", selected\)/);
  assert.doesNotMatch(model, /searchParams\.set\("n"/,
    "shareable capability URLs never carry names");
  assert.match(model, /runtime\.loadHostRoom\(\)/);
  assert.match(model, /runtime\.saveHostRoom\(JSON\.stringify\(room\)\)/);
  assert.match(model, /runtime\.forgetHostRoom\(\)/);
});

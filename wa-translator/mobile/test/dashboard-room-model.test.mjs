import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared native dashboard centralizes room capability and persistence rules", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const model = await readFile(new URL("dashboard-room-model.js", root), "utf8");
  const dashboard = await readFile(new URL("dashboard.js", root), "utf8");

  const modelTag = html.indexOf('<script src="/dashboard-room-model.js"></script>');
  const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');
  assert.ok(modelTag >= 0 && dashboardTag > modelTag,
    "room model loads before dashboard orchestration");

  assert.match(dashboard, /window\.LinguaDashboardRoomModel\.create\(runtime\)/);
  assert.match(dashboard, /roomModel\.inviteUrl\(room\)/);
  assert.match(dashboard, /roomModel\.valid\(value\)/);
  assert.match(dashboard, /roomModel\.normalizeMode\(mode\)/);

  assert.match(model, /const MODES = new Set\(\["voice", "chat", "video"\]\)/);
  assert.match(model, /return MODES\.has\(value\) \? value : "video"/);
  assert.match(model, /url\.searchParams\.set\("m", selected\)/);
  assert.doesNotMatch(model, /searchParams\.set\("n"/,
    "shareable capability URLs never carry names");
  assert.match(model, /typeof value\.path === "string"/);
  assert.match(model, /typeof value\.host_control === "string"/);
  assert.match(model, /Number\.isSafeInteger\(value\.expires_at\)/);
  assert.match(model, /runtime\.loadHostRoom\(\)/);
  assert.match(model, /runtime\.saveHostRoom\(JSON\.stringify\(room\)\)/);
  assert.match(model, /runtime\.forgetHostRoom\(\)/);
});

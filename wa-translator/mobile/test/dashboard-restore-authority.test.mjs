import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../www/dashboard-room-controller.js", import.meta.url), "utf8");

function loadController() {
  const context = {
    window: {},
    document: {visibilityState: "visible"},
    setInterval: () => 1,
    clearInterval: () => {},
  };
  vm.runInNewContext(source, context, {filename: "dashboard-room-controller.js"});
  return context.window.LinguaDashboardRoomController;
}

test("foreground restore never replaces a known active in-memory room", async () => {
  const created = {
    path: "/room/live-capability",
    host_control: "host-control-live",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  let loads = 0;
  const model = {
    normalizeMode: value => value,
    valid: value => Boolean(value?.path && value?.host_control && value?.expires_at),
    save: async () => true,
    load: async () => { loads++; return null; },
    forget: async () => true,
    mode: value => value?.mode || "video",
  };
  const controller = loadController().create({
    runtime: {apiUrl: path => path, openRoom: () => true},
    fetch: async input => {
      if (String(input).endsWith("/api/rooms")) return Response.json({...created});
      throw new Error(`unexpected request ${input}`);
    },
    model,
    events: () => null,
    confirmAction: () => true,
    onBusy: () => {},
    onNotice: () => {},
    onRender: () => {},
    onClear: () => {},
  });

  assert.equal(await controller.create("video"), true);
  const active = controller.current();
  assert.equal(await controller.restore(), active,
    "the process-local active capability remains authoritative on foreground");
  assert.equal(controller.current(), active);
  assert.equal(loads, 0,
    "restore must not consult an externally-cleared slot while live custody is already known");
});

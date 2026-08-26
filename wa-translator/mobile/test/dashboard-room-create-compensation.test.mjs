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

function jsonResponse(status, body = null) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? undefined : {"Content-Type": "application/json"},
  });
}

const CREATED_ROOM = Object.freeze({
  path: "/room/abcdefghijklmnopqrstuvwx.1787700000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  host_control: "hc1.abcdefghijklmnopqrstuvwx.1787700000.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  expires_at: 1787700000,
});

test("a server-created room is closed when its host capability cannot be persisted", async () => {
  const requests = [];
  const events = [];
  const clears = [];
  const model = {
    normalizeMode: value => value,
    valid: () => true,
    save: async () => false,
    load: async () => null,
    forget: async () => true,
    mode: value => value?.mode || "video",
  };
  const runtime = {
    apiUrl: path => `https://room.test${path}`,
    openRoom: () => true,
  };
  const controller = loadController().create({
    runtime,
    fetch: async (input, init = {}) => {
      const path = new URL(String(input)).pathname;
      requests.push({path, authorization: init.headers?.Authorization || ""});
      if (path === "/api/rooms") return jsonResponse(200, {...CREATED_ROOM});
      if (path === "/api/room-control/close") return jsonResponse(200);
      throw new Error(`unexpected request ${path}`);
    },
    model,
    events: () => ({emit: (name, properties) => events.push({name, properties})}),
    confirmAction: () => true,
    onBusy: () => {},
    onNotice: () => {},
    onRender: () => { throw new Error("unpersisted room must never render"); },
    onClear: (state, key, options) => clears.push({state, key, options}),
  });

  assert.equal(await controller.create("video"), false);
  assert.equal(controller.current(), null);
  assert.deepEqual(requests.map(value => value.path), [
    "/api/rooms",
    "/api/room-control/close",
  ]);
  assert.equal(requests[1].authorization, `Bearer ${CREATED_ROOM.host_control}`);
  assert.deepEqual(events, [{
    name: "room.create.result",
    properties: {mode: "video", result: "failure"},
  }]);
  assert.deepEqual(clears, [{
    state: "error",
    key: "home.createFailed",
    options: {preserveRoom: true},
  }]);
});

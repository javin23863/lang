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

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return {promise, resolve};
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const CREATED_ROOM = Object.freeze({
  path: "/room/abcdefghijklmnopqrstuvwx.1787700000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  host_control: "hc1.abcdefghijklmnopqrstuvwx.1787700000.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  expires_at: 1787700000,
});

function harness({fetchImpl, save = async () => true}) {
  const requests = [];
  const events = [];
  const clears = [];
  let forgotten = 0;
  const model = {
    normalizeMode: value => value,
    valid: () => true,
    save,
    load: async () => null,
    forget: async () => { forgotten++; return true; },
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
      return fetchImpl(path, init);
    },
    model,
    events: () => ({emit: (name, properties) => events.push({name, properties})}),
    confirmAction: () => true,
    onBusy: () => {},
    onNotice: () => {},
    onRender: () => { throw new Error("retired room must never render"); },
    onClear: (state, key, options) => clears.push({state, key, options}),
  });
  return {controller, requests, events, clears, forgotten: () => forgotten};
}

test("a server-created room is closed when its host capability cannot be persisted", async () => {
  const h = harness({
    save: async () => false,
    fetchImpl: async path => {
      if (path === "/api/rooms") return jsonResponse(200, {...CREATED_ROOM});
      if (path === "/api/room-control/close") return jsonResponse(200);
      throw new Error(`unexpected request ${path}`);
    },
  });

  assert.equal(await h.controller.create("video"), false);
  assert.equal(h.controller.current(), null);
  assert.deepEqual(h.requests.map(value => value.path), [
    "/api/rooms",
    "/api/room-control/close",
  ]);
  assert.equal(h.requests[1].authorization, `Bearer ${CREATED_ROOM.host_control}`);
  assert.deepEqual(plain(h.events), [{
    name: "room.create.result",
    properties: {mode: "video", result: "failure"},
  }]);
  assert.deepEqual(plain(h.clears), [{
    state: "error",
    key: "home.createFailed",
    options: {preserveRoom: true},
  }]);
});

test("account teardown retires a room whose successful create response arrives afterward", async () => {
  const pendingCreate = deferred();
  const h = harness({
    fetchImpl: async path => {
      if (path === "/api/rooms") return pendingCreate.promise;
      if (path === "/api/room-control/close") return jsonResponse(200);
      throw new Error(`unexpected request ${path}`);
    },
  });

  const result = h.controller.create("chat");
  await h.controller.discard();
  pendingCreate.resolve(jsonResponse(200, {...CREATED_ROOM}));

  assert.equal(await result, false);
  assert.equal(h.controller.current(), null);
  assert.deepEqual(h.requests.map(value => value.path), [
    "/api/rooms",
    "/api/room-control/close",
  ]);
  assert.equal(h.requests[1].authorization, `Bearer ${CREATED_ROOM.host_control}`);
  assert.equal(h.forgotten(), 1,
    "teardown retires local custody while the late response is closed remotely");
  assert.deepEqual(plain(h.events), [], "teardown is not reported as create success or failure");
  assert.deepEqual(plain(h.clears), [], "teardown does not paint a create error over sign-out");
});

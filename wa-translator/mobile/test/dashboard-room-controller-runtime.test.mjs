import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../www/dashboard-room-controller.js", import.meta.url), "utf8");

function response(status, body = null) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? undefined : {"Content-Type": "application/json"},
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

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

function harness(fetchImpl) {
  const events = [];
  const clears = [];
  const notices = [];
  const busy = [];
  let forgotten = 0;
  let saved = 0;
  const model = {
    normalizeMode: mode => ["voice", "chat", "video"].includes(mode) ? mode : "video",
    valid: value => Boolean(value?.path && value?.host_control && value?.expires_at),
    save: async () => { saved++; return true; },
    load: async () => null,
    forget: async () => { forgotten++; },
    mode: value => value?.mode || "video",
  };
  const runtime = {
    apiUrl: path => `https://room.test${path}`,
    openRoom: () => true,
  };
  const controller = loadController().create({
    runtime,
    fetch: fetchImpl,
    model,
    events: () => ({emit: (name, properties) => events.push({name, properties})}),
    confirmAction: () => true,
    onBusy: value => busy.push(value),
    onNotice: key => notices.push(key),
    onRender: () => {},
    onClear: (state, key, options) => clears.push({state, key, options}),
  });
  return {controller, events, clears, notices, busy, model, stats: () => ({forgotten, saved})};
}

const CREATED_ROOM = Object.freeze({
  path: "/room/test-capability",
  host_control: "host-control-test",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
});

test("room creation failure is terminal for the operation but leaves the controller reusable", async () => {
  const h = harness(async () => { throw new Error("offline"); });
  assert.equal(await h.controller.create("video"), false);
  assert.equal(h.controller.current(), null);
  assert.deepEqual(h.stats(), {forgotten: 0, saved: 0});
  assert.deepEqual(plain(h.clears.at(-1)), {
    state: "error", key: "home.createFailed", options: {preserveRoom: true},
  });
  assert.deepEqual(plain(h.events.at(-1)), {
    name: "room.create.result", properties: {mode: "video", result: "failure"},
  });
  assert.deepEqual(h.busy.slice(-2), [true, false]);
});

test("temporary room-status failure preserves the host control for recovery", async () => {
  const replies = [response(200, {...CREATED_ROOM}), response(503)];
  const h = harness(async () => replies.shift());
  assert.equal(await h.controller.create("voice"), true);
  const retained = h.controller.current();
  await h.controller.refresh();
  assert.equal(h.controller.current(), retained);
  assert.equal(h.stats().forgotten, 0);
  assert.deepEqual(plain(h.clears.at(-1)), {
    state: "error", key: "home.statusUnavailable", options: {preserveRoom: true},
  });
});

test("revoked host control is cleared instead of retrying a capability that no longer works", async () => {
  const replies = [response(200, {...CREATED_ROOM}), response(403)];
  const h = harness(async () => replies.shift());
  assert.equal(await h.controller.create("chat"), true);
  await h.controller.refresh();
  assert.equal(h.controller.current(), null);
  assert.equal(h.stats().forgotten, 1);
  assert.deepEqual(plain(h.clears.at(-1)), {state: "expired", key: "home.controlLost"});
});

test("failed close keeps the room available and emits a coarse failure result", async () => {
  const replies = [response(200, {...CREATED_ROOM}), response(503)];
  const h = harness(async () => replies.shift());
  assert.equal(await h.controller.create("video"), true);
  const retained = h.controller.current();
  assert.equal(await h.controller.close(false), false);
  assert.equal(h.controller.current(), retained);
  assert.equal(h.stats().forgotten, 0);
  assert.deepEqual(plain(h.events.at(-1)), {
    name: "room.close.result", properties: {result: "failure"},
  });
  assert.deepEqual(plain(h.clears.at(-1)), {
    state: "error", key: "home.closeFailed", options: {preserveRoom: true},
  });
});

test("a delayed status response for a replaced room cannot clear the new host control", async () => {
  const staleStatus = deferred();
  const replacement = {
    path: "/room/new-capability",
    host_control: "host-control-new",
    expires_at: Math.floor(Date.now() / 1000) + 7200,
  };
  let creates = 0;
  const h = harness(async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/rooms") {
      creates++;
      return response(200, creates === 1 ? {...CREATED_ROOM} : replacement);
    }
    if (path === "/api/room-control/close") return response(200);
    if (path === "/api/room-control") return staleStatus.promise;
    throw new Error(`unexpected request ${path}`);
  });

  assert.equal(await h.controller.create("video"), true);
  const oldRoom = h.controller.current();
  const oldRefresh = h.controller.refresh();
  assert.equal(await h.controller.create("chat"), true);
  const newRoom = h.controller.current();
  assert.notEqual(newRoom, oldRoom);
  assert.equal(newRoom.path, replacement.path);
  assert.deepEqual(h.stats(), {forgotten: 1, saved: 2},
    "replacement closes and forgets only the old room");

  staleStatus.resolve(response(403));
  await oldRefresh;

  assert.equal(h.controller.current(), newRoom,
    "old authorization failure cannot clear the replacement room");
  assert.deepEqual(h.stats(), {forgotten: 1, saved: 2});
  assert.equal(h.clears.some(entry => entry.key === "home.controlLost"), false);
});

test("account teardown invalidates a room creation that is already in flight", async () => {
  const pendingCreate = deferred();
  const h = harness(async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/rooms") return pendingCreate.promise;
    throw new Error(`unexpected request ${path}`);
  });

  const createResult = h.controller.create("video");
  await h.controller.discard();
  assert.equal(h.controller.current(), null);
  assert.deepEqual(h.stats(), {forgotten: 1, saved: 0});

  pendingCreate.resolve(response(200, {...CREATED_ROOM}));
  assert.equal(await createResult, false);
  assert.equal(h.controller.current(), null,
    "a response from the signed-out account cannot resurrect host control");
  assert.deepEqual(h.stats(), {forgotten: 1, saved: 0},
    "the invalidated response is rejected before persistence");
  assert.equal(h.events.some(entry => entry.name === "room.create.result"), false,
    "teardown is not misreported as a create failure or success");
});

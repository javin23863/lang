import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../../windows/static/qr.js", import.meta.url),
  "utf8",
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}

class MockTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
  }
  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener.call(this, event);
  }
}

class MockWebSocket extends MockTarget {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static created = 0;
  constructor() {
    super();
    this.readyState = 0;
    MockWebSocket.created++;
  }
}

class MockPeerConnection {}

function element() {
  const target = new MockTarget();
  target.disabled = false;
  target.textContent = "";
  target.classList = {
    values: new Set(),
    add(value) { this.values.add(value); },
    remove(value) { this.values.delete(value); },
    contains(value) { return this.values.has(value); },
  };
  return target;
}

function harness({partial = false, failLoads = 0, deferredLoads = false} = {}) {
  MockWebSocket.created = 0;
  const windowTarget = new MockTarget();
  const timers = [];
  windowTarget.setTimeout = (callback, delay) => {
    timers.push({callback, delay, cleared: false});
    return timers.length;
  };
  windowTarget.clearTimeout = id => {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  };
  windowTarget.fetch = async () => ({ok: true, status: 200});
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.RTCPeerConnection = MockPeerConnection;
  windowTarget.LinguaNative = undefined;

  const loadGates = [];
  windowTarget.nextCapabilityLoad = () => {
    const gate = deferred();
    loadGates.push(gate);
    return gate.promise;
  };

  const elements = new Map([
    ["roleLocaleSel", element()],
    ["joinBtn", element()],
    ["roleCapability", element()],
    ["leaveBtn", element()],
    ["reportBtn", element()],
    ["qrBtn", element()],
  ]);
  const qrCore = new MockTarget();
  const document = new MockTarget();
  document.visibilityState = "visible";
  document.getElementById = id => elements.get(id) || null;
  document.createElement = tag => {
    assert.equal(tag, "script");
    return qrCore;
  };
  document.head = {appendChild() {}};

  const context = vm.createContext({
    window: windowTarget,
    document,
    navigator: {mediaDevices: null},
    location: {
      pathname: "/room/example",
      origin: "https://room.test",
      href: "https://room.test/room/example",
    },
    URL,
    Request,
    AbortController,
    DOMException,
    EventTarget,
    Date,
    Map,
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  });

  const roomGlobals = `
    let catalog = ${partial ? "{revision: 'partial'}" : "null"};
    const locales = new Map();
    const voices = new Map();
    ${partial ? "locales.set('broken', {id: 'broken'});" : ""}
    let roleChosen = false;
    let explicitLeave = false;
    let terminalRoom = false;
    let gateFailureKey = 'gate.languagesUnavailable';
    let loadCount = 0;
    let statusKey = '';
    let roleUpdateCount = 0;
    function t(key) { return key; }
    function setStatus(key) { statusKey = key; }
    function updateRoleGate() { roleUpdateCount++; }
    function disconnectRoom() {}
    window.addEventListener('pagehide', () => disconnectRoom());
    async function loadCapabilities() {
      loadCount++;
      if (${Boolean(deferredLoads)}) {
        const result = await window.nextCapabilityLoad();
        if (result === 'fail') {
          gateFailureKey = 'gate.languagesUnavailable';
          return;
        }
      }
      if (loadCount <= ${Number(failLoads)}) {
        gateFailureKey = 'gate.languagesUnavailable';
        return;
      }
      catalog = {revision: 'r1'};
      gateFailureKey = '';
      document.getElementById('roleLocaleSel').disabled = false;
    }
    function capabilityRecoveryState() {
      return {
        catalogReady: catalog !== null,
        gateFailureKey,
        loadCount,
        statusKey,
        roleUpdateCount,
      };
    }
  `;
  vm.runInContext(roomGlobals, context, {filename: "room-globals.js"});
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    context,
    windowTarget,
    document,
    elements,
    timers,
    loadGates,
    state: () => context.capabilityRecoveryState(),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("online recovery reloads capabilities without joining or reopening signalling", async () => {
  const h = harness();
  h.windowTarget.dispatch("online", {type: "online"});
  await settle();

  const state = h.state();
  assert.equal(state.loadCount, 1);
  assert.equal(state.catalogReady, true);
  assert.equal(state.gateFailureKey, "");
  assert.equal(state.statusKey, "gate.title");
  assert.equal(state.roleUpdateCount, 1);
  assert.equal(h.elements.get("roleLocaleSel").disabled, false);
  assert.equal(MockWebSocket.created, 0, "capability recovery cannot join or signal for the user");
});

test("the timeout fallback retries only after the room has actually entered capability failure", async () => {
  const h = harness();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, 13000);

  // A healthy still-loading gate has no failure key, so the fallback cannot
  // race the original bootstrap. Simulate that state before firing it.
  vm.runInContext("gateFailureKey = ''", h.context);
  h.timers[0].callback();
  await settle();
  assert.equal(h.state().loadCount, 0);

  vm.runInContext("gateFailureKey = 'gate.languagesUnavailable'", h.context);
  h.document.dispatch("visibilitychange", {type: "visibilitychange"});
  await settle();
  assert.equal(h.state().loadCount, 1);
});

test("partially applied catalog state is fail-closed and never replayed", async () => {
  const h = harness({partial: true});
  h.windowTarget.dispatch("online", {type: "online"});
  h.document.dispatch("visibilitychange", {type: "visibilitychange"});
  await settle();
  assert.equal(h.state().loadCount, 0);
  assert.equal(h.state().gateFailureKey, "gate.languagesUnavailable");
});

test("failed recovery backs off and stays within the three-attempt rolling bound", async () => {
  const h = harness({failLoads: 10});
  h.windowTarget.dispatch("online", {type: "online"});
  await settle();
  assert.equal(h.state().loadCount, 1);

  // First entry is the 13-second initial fallback. Each failed recovery adds
  // one bounded backoff timer. Fire only live timers in order.
  for (let i = 1; i < h.timers.length && h.state().loadCount < 3; i++) {
    if (!h.timers[i].cleared) {
      h.timers[i].callback();
      await settle();
    }
  }
  assert.equal(h.state().loadCount, 3);

  h.windowTarget.dispatch("online", {type: "online"});
  h.document.dispatch("visibilitychange", {type: "visibilitychange"});
  await settle();
  assert.equal(h.state().loadCount, 3, "events cannot bypass the rolling retry cap");
});

test("BFCache restore waits for stale capability work and then starts its own generation", async () => {
  const h = harness({deferredLoads: true});
  h.windowTarget.dispatch("online", {type: "online"});
  await settle();
  assert.equal(h.state().loadCount, 1);
  assert.equal(h.loadGates.length, 1);

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});
  await settle();
  assert.equal(h.state().loadCount, 1,
    "restored generation waits for stale capability work instead of coalescing onto it");

  h.loadGates[0].resolve("fail");
  await settle();
  await settle();
  assert.equal(h.state().loadCount, 2,
    "fresh generation automatically starts after the stale retry retires");
  assert.equal(h.loadGates.length, 2);

  h.loadGates[1].resolve("success");
  await settle();
  await settle();
  const state = h.state();
  assert.equal(state.catalogReady, true);
  assert.equal(state.gateFailureKey, "");
  assert.equal(state.statusKey, "gate.title");
  assert.equal(state.roleUpdateCount, 1);
});

test("source keeps capability recovery pre-join, lifecycle-aware, generation-bound, and bounded", () => {
  assert.match(source, /const CAPABILITY_RETRY_WINDOW_MS = 60 \* 1000/);
  assert.match(source, /const CAPABILITY_RETRY_MAX_PER_WINDOW = 3/);
  assert.match(source, /catalog === null && locales\.size === 0 && voices\.size === 0/);
  assert.match(source, /!roleChosen && !explicitLeave && !terminalRoom/);
  assert.match(source, /!roomSuspended && !roomLifecycleEnded/);
  assert.match(source, /let capabilityRetryGeneration = -1/);
  assert.match(source, /capabilityRetryGeneration === generation/);
  assert.match(source, /previousTask && previousGeneration !== generation/);
  assert.match(source, /await previousTask/);
  assert.match(source, /browserRoomGenerationActive\(generation\)[\s\S]*?canRetryCapabilities\(\)/);
  assert.match(source, /gateFailureKey = ""/);
  assert.match(source, /await Promise\.resolve\(loadCapabilities\(\)\)/);
  assert.match(source, /capabilityRetryPromise === task/);
  assert.match(source, /window\.addEventListener\("online", retryCapabilities\)/);
  assert.match(source, /event\.detail\?\.isActive\) retryCapabilities\(\)/);
  assert.match(source, /document\.visibilityState === "visible"\) retryCapabilities\(\)/);
  assert.match(source, /ROOM_CONTROL_FETCH_TIMEOUT_MS \+ 1000/);
});

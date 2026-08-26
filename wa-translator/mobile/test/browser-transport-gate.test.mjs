import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../../windows/static/qr.js", import.meta.url),
  "utf8",
);

class MockTarget {
  constructor() {
    this.listeners = new Map();
    this.onclick = null;
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({listener, capture: Boolean(options?.capture)});
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(entry => entry.listener !== listener));
  }

  dispatch(type, event = {}) {
    const dispatched = Object.assign(event, {
      type,
      defaultPrevented: false,
      immediateStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.immediateStopped = true; },
    });
    const listeners = [...(this.listeners.get(type) || [])];
    for (const phase of [true, false]) {
      for (const entry of listeners.filter(candidate => candidate.capture === phase)) {
        entry.listener.call(this, dispatched);
        if (dispatched.immediateStopped) return dispatched;
      }
    }
    if (type === "click" && typeof this.onclick === "function") this.onclick(dispatched);
    return dispatched;
  }
}

class MockWebSocket extends MockTarget {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor() {
    super();
    this.readyState = 0;
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

function harness({
  fetch = true,
  webSocket = true,
  peerConnection = true,
  native = false,
  pathname = "/room/example",
} = {}) {
  const windowTarget = new MockTarget();
  const timers = [];
  windowTarget.setTimeout = (callback, delay) => {
    timers.push({callback, delay, cleared: false});
    return timers.length;
  };
  windowTarget.clearTimeout = id => {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  };
  if (fetch) windowTarget.fetch = async () => ({ok: true, status: 200, headers: new Map()});
  if (webSocket) windowTarget.WebSocket = MockWebSocket;
  if (peerConnection) windowTarget.RTCPeerConnection = MockPeerConnection;
  windowTarget.LinguaNative = native ? {isNative: true} : undefined;

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
    location: {
      pathname,
      origin: "https://room.test",
      href: `https://room.test${pathname}`,
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

  vm.runInContext(`
    let catalog = null;
    const locales = new Map();
    const voices = new Map();
    let roleChosen = false;
    let explicitLeave = false;
    let terminalRoom = false;
    let gateFailureKey = '';
    let statusKey = '';
    let updateCount = 0;
    let chooseCount = 0;
    let loadCount = 0;
    function t(key) { return key; }
    function setStatus(key) { statusKey = key; }
    function loadCapabilities() { loadCount++; return Promise.resolve(); }
    function updateRoleGate() {
      updateCount++;
      document.getElementById('roleLocaleSel').disabled = false;
      document.getElementById('joinBtn').disabled = false;
      document.getElementById('roleCapability').textContent = 'ready';
      document.getElementById('roleCapability').classList.remove('warning');
    }
    document.getElementById('joinBtn').onclick = () => { chooseCount++; };
    function transportGateState() {
      return {gateFailureKey, statusKey, updateCount, chooseCount, loadCount};
    }
  `, context, {filename: "room-globals.js"});
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    context,
    windowTarget,
    document,
    elements,
    timers,
    state: () => context.transportGateState(),
  };
}

for (const [name, options] of [
  ["WebSocket", {webSocket: false}],
  ["RTCPeerConnection", {peerConnection: false}],
  ["fetch", {fetch: false}],
  ["all room transports", {fetch: false, webSocket: false, peerConnection: false}],
]) {
  test(`missing ${name} fails the browser room gate closed`, () => {
    const h = harness(options);
    assert.equal(h.state().gateFailureKey, "gate.updateRequired");
    assert.equal(h.state().statusKey, "gate.updateRequired");
    assert.equal(h.elements.get("roleLocaleSel").disabled, true);
    assert.equal(h.elements.get("joinBtn").disabled, true);
    assert.equal(h.elements.get("roleCapability").textContent, "gate.updateRequired");
    assert.equal(h.elements.get("roleCapability").classList.contains("warning"), true);
  });
}

test("late capability gate repaint cannot re-enable Join without browser transports", () => {
  const h = harness({peerConnection: false});
  vm.runInContext("updateRoleGate()", h.context);
  assert.equal(h.state().updateCount, 1, "the room's existing gate update still runs");
  assert.equal(h.state().gateFailureKey, "gate.updateRequired");
  assert.equal(h.elements.get("roleLocaleSel").disabled, true);
  assert.equal(h.elements.get("joinBtn").disabled, true);
  assert.equal(h.elements.get("roleCapability").textContent, "gate.updateRequired");
});

test("capture-phase unsupported gate blocks Join even after an external enable", () => {
  const h = harness({webSocket: false});
  const join = h.elements.get("joinBtn");
  join.disabled = false;
  const event = join.dispatch("click", {});

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.immediateStopped, true);
  assert.equal(h.state().chooseCount, 0, "the room Join handler never runs");
  assert.equal(join.disabled, true, "the hard guard restores the disabled state");
  assert.equal(h.state().gateFailureKey, "gate.updateRequired");
});

test("unsupported rooms do not spend capability retry budget on online or fallback events", async () => {
  const h = harness({peerConnection: false});
  h.windowTarget.dispatch("online", {});
  for (const timer of h.timers) {
    if (!timer.cleared && timer.delay === 13000) timer.callback();
  }
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.state().loadCount, 0);
  assert.equal(h.state().gateFailureKey, "gate.updateRequired");
});

test("supported browser rooms retain the room-owned Join gate", () => {
  const h = harness();
  assert.equal(h.state().gateFailureKey, "");
  vm.runInContext("updateRoleGate()", h.context);
  assert.equal(h.elements.get("joinBtn").disabled, false);
  h.elements.get("joinBtn").dispatch("click", {});
  assert.equal(h.state().chooseCount, 1);
});

test("dashboard and native routes are not transport-gated by the browser room shim", () => {
  for (const h of [
    harness({fetch: false, webSocket: false, peerConnection: false, pathname: "/"}),
    harness({fetch: false, webSocket: false, peerConnection: false, native: true}),
  ]) {
    assert.equal(h.state().gateFailureKey, "");
    assert.equal(h.elements.get("joinBtn").disabled, false);
  }
});

test("source keeps unsupported transport enforcement outside capability retry", () => {
  assert.match(source, /const browserRoomSupported = native \|\| !roomRoute \|\| \(/);
  assert.match(source, /typeof window\.WebSocket === "function"/);
  assert.match(source, /typeof window\.RTCPeerConnection === "function"/);
  assert.match(source, /function renderUnsupportedRoomGate\(\)/);
  assert.match(source, /gateFailureKey = "gate\.updateRequired"/);
  assert.match(source, /updateRoleGate = function transportAwareRoleGate/);
  assert.match(source, /event\.stopImmediatePropagation\?\.\(\)/);
  assert.match(source, /\{capture: true\}/);
  assert.match(source, /if \(!browserRoomSupported[\s\S]*typeof loadCapabilities !== "function"/);
});

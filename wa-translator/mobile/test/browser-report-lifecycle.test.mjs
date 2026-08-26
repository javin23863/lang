import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../../windows/static/qr.js", import.meta.url),
  "utf8",
);

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
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor() {
    super();
    this.readyState = MockWebSocket.CONNECTING;
  }
}

class MockRTCPeerConnection {}

function harness() {
  const windowTarget = new MockTarget();
  const reportButton = new MockTarget();
  const leaveButton = new MockTarget();
  const qrButton = new MockTarget();
  const qrScript = new MockTarget();
  reportButton.disabled = false;
  qrButton.disabled = false;

  const elements = new Map([
    ["reportBtn", reportButton],
    ["leaveBtn", leaveButton],
    ["qrBtn", qrButton],
  ]);
  const document = new MockTarget();
  document.visibilityState = "visible";
  document.getElementById = id => elements.get(id) || null;
  document.createElement = () => qrScript;
  document.head = {appendChild() {}};

  const fetchCalls = [];
  const disconnectCalls = [];
  windowTarget.fetch = (input, init = {}) => new Promise((resolve, reject) => {
    const call = {input: String(input), init, resolve, reject};
    fetchCalls.push(call);
    if (init.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    init.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, {once: true});
  });
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.RTCPeerConnection = MockRTCPeerConnection;
  windowTarget.LinguaNative = undefined;

  const context = vm.createContext({
    window: windowTarget,
    document,
    navigator: {mediaDevices: null},
    disconnectRoom(...args) { disconnectCalls.push(args); },
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
    WeakSet,
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(source, context, {filename: "qr.js"});
  return {
    windowTarget,
    reportButton,
    fetchCalls,
    disconnectCalls,
    disconnect: (...args) => context.disconnectRoom(...args),
  };
}

test("confirmed report teardown preserves its report request while aborting other room control work", async () => {
  const h = harness();
  let reportRequest;
  let roomRequest;
  h.reportButton.addEventListener("click", () => {
    h.reportButton.disabled = true;
    reportRequest = h.windowTarget.fetch("https://room.test/api/reports", {method: "POST"});
    roomRequest = h.windowTarget.fetch("https://room.test/api/room");
  });

  h.reportButton.dispatch("click", {type: "click"});
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.fetchCalls.length, 2);
  assert.equal(h.fetchCalls[0].input, "https://room.test/api/reports");
  assert.equal(h.fetchCalls[0].init.signal.aborted, false,
    "confirmed report delivery remains alive through immediate room teardown");
  assert.equal(h.fetchCalls[1].init.signal.aborted, true,
    "unrelated room-control work is still cancelled immediately");
  await assert.rejects(roomRequest, error => error?.name === "AbortError");

  h.fetchCalls[0].resolve({ok: true, status: 204});
  const response = await reportRequest;
  assert.equal(response.ok, true);

  await assert.rejects(
    h.windowTarget.fetch("https://room.test/api/room"),
    error => error?.name === "AbortError",
    "confirmed report still permanently ends later room control work",
  );
  assert.equal(h.fetchCalls.length, 2, "post-report room work is rejected before network I/O");
});

test("pagehide preserves pending confirmed report delivery and registration teardown until authorization settles", async () => {
  const h = harness();
  let reportRequest;
  h.reportButton.addEventListener("click", () => {
    h.reportButton.disabled = true;
    reportRequest = h.windowTarget.fetch("https://room.test/api/reports", {method: "POST"});
  });

  h.reportButton.dispatch("click", {type: "click"});
  await Promise.resolve();
  await Promise.resolve();

  h.windowTarget.dispatch("pagehide", {type: "pagehide"});
  h.disconnect(false);

  assert.equal(h.fetchCalls[0].init.signal.aborted, false,
    "pagehide must not abort a confirmed report still awaiting backend authorization");
  assert.equal(h.disconnectCalls.length, 0,
    "suspension must not close participant registration while report authorization is pending");

  h.fetchCalls[0].resolve({ok: true, status: 204});
  assert.equal((await reportRequest).ok, true);

  h.disconnect(false);
  assert.deepEqual(h.disconnectCalls, [[false]],
    "normal suspension teardown resumes immediately after report delivery settles");
});

test("source preserves only tracked confirmed report delivery through teardown and pagehide", () => {
  assert.match(source, /let browserReportDeliveryCount = 0/);
  assert.match(source, /let browserConfirmedReportPending = false/);
  assert.match(source, /function browserConfirmedReportActive\(\)/);
  assert.match(source, /function abortControlRequests\(preserveReportRequest = false\)/);
  assert.match(source, /preserveReportRequest && reportControlControllers\.has\(controller\)/);
  assert.match(source, /function endRoomLifecycle\(preserveReportRequest = false\)/);
  assert.match(source,
    /browserConfirmedReportActive\(\)[\s\S]*?notifyServer === false && preserveServerClose !== true/);
  assert.match(source,
    /const preserveReportRequest = browserConfirmedReportActive\(\);[\s\S]*?abortControlRequests\(preserveReportRequest\)/);
  assert.match(source,
    /if \(reportButton\.disabled\) \{[\s\S]*?browserConfirmedReportPending = true;[\s\S]*?quiesceRoomForReport\(\);[\s\S]*?endRoomLifecycle\(true\)/);
  assert.match(source,
    /const reportRequest = url\.pathname === "\/api\/reports";[\s\S]*?reportControlControllers\.add\(controller\);[\s\S]*?browserReportDeliveryCount\+\+/);
  assert.match(source,
    /browserReportDeliveryCount = Math\.max\(0, browserReportDeliveryCount - 1\);[\s\S]*?browserConfirmedReportPending = false/);
});

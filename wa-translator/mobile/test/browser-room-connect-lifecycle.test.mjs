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
  }

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
  static created = [];

  constructor(url, protocols) {
    super();
    this.url = String(url);
    this.protocols = protocols;
    this.readyState = MockWebSocket.CONNECTING;
    this.binaryType = "blob";
    MockWebSocket.created.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch("close", {type: "close"});
  }

  send() {}
}

function harness() {
  MockWebSocket.created = [];
  const windowTarget = new MockTarget();
  const leaveButton = new MockTarget();
  const reportButton = new MockTarget();
  const qrButton = new MockTarget();
  const qrScript = new MockTarget();
  const turnScheduleCalls = [];
  reportButton.disabled = false;
  qrButton.disabled = false;

  const elements = new Map([
    ["leaveBtn", leaveButton],
    ["reportBtn", reportButton],
    ["qrBtn", qrButton],
  ]);
  const document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) {
      assert.equal(tag, "script");
      return qrScript;
    },
    head: { appendChild() {} },
  };

  const fetchCalls = [];
  const nativeFetch = (input, init = {}) => new Promise((resolve, reject) => {
    const call = {input, init};
    fetchCalls.push(call);
    if (init.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    init.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, {once: true});
    call.resolve = resolve;
  });

  windowTarget.fetch = nativeFetch;
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.LinguaNative = undefined;
  windowTarget.scheduleTurnRefresh = delay => {
    turnScheduleCalls.push(delay);
  };

  const context = vm.createContext({
    window: windowTarget,
    document,
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
    queueMicrotask,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    windowTarget,
    leaveButton,
    reportButton,
    qrButton,
    qrScript,
    fetchCalls,
    turnScheduleCalls,
  };
}

test("page suspension aborts browser room control work and cannot reopen signalling or TURN retries", async () => {
  const {windowTarget, fetchCalls, turnScheduleCalls} = harness();
  const pending = windowTarget.fetch("https://room.test/api/room");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.signal.aborted, false);

  windowTarget.dispatch("pagehide", {persisted: true});
  await assert.rejects(pending, error => error?.name === "AbortError");
  assert.equal(fetchCalls[0].init.signal.aborted, true);

  const blockedSocket = new windowTarget.WebSocket("wss://room.test/ws/example");
  assert.equal(MockWebSocket.created.length, 0, "suspended stale connect cannot create a real socket");
  assert.equal(blockedSocket.readyState, MockWebSocket.CLOSED);
  await assert.rejects(
    windowTarget.fetch("https://room.test/api/turn"),
    error => error?.name === "AbortError",
  );
  assert.equal(fetchCalls.length, 1, "suspended control fetch is rejected before network I/O");
  windowTarget.scheduleTurnRefresh(30000);
  assert.deepEqual(turnScheduleCalls, [], "an aborted stale TURN fetch cannot re-arm its retry timer");
});

test("BFCache restore coalesces stale and fresh connects and re-enables live TURN scheduling", () => {
  const {windowTarget, turnScheduleCalls} = harness();
  windowTarget.dispatch("pagehide", {persisted: true});
  windowTarget.dispatch("pageshow", {persisted: true});

  windowTarget.scheduleTurnRefresh(45000);
  assert.deepEqual(turnScheduleCalls, [45000], "restored live room keeps the original TURN scheduler");

  const first = new windowTarget.WebSocket("wss://room.test/ws/example");
  const second = new windowTarget.WebSocket("wss://room.test/ws/example");
  assert.equal(MockWebSocket.created.length, 1, "parallel restored connects create one real socket");
  assert.equal(second, first, "a second connect reuses the connecting/open room socket");

  first.close();
  const replacement = new windowTarget.WebSocket("wss://room.test/ws/example");
  assert.notEqual(replacement, first);
  assert.equal(MockWebSocket.created.length, 2, "a genuinely closed socket can be replaced");
});

test("explicit Leave and confirmed report-and-block permanently reject stale reconnect work", async () => {
  const leaveHarness = harness();
  leaveHarness.leaveButton.dispatch("click", {type: "click"});
  const afterLeave = new leaveHarness.windowTarget.WebSocket("wss://room.test/ws/example");
  assert.equal(afterLeave.readyState, MockWebSocket.CLOSED);
  assert.equal(MockWebSocket.created.length, 0, "Leave prevents stale signalling recreation");
  await assert.rejects(
    leaveHarness.windowTarget.fetch("https://room.test/api/room"),
    error => error?.name === "AbortError",
  );
  assert.equal(leaveHarness.fetchCalls.length, 0);
  leaveHarness.windowTarget.scheduleTurnRefresh(30000);
  assert.deepEqual(leaveHarness.turnScheduleCalls, [], "Leave cannot resurrect a TURN retry loop");

  const reportHarness = harness();
  reportHarness.reportButton.addEventListener("click", () => {
    reportHarness.reportButton.disabled = true;
  });
  reportHarness.reportButton.dispatch("click", {type: "click"});
  await Promise.resolve();
  const afterReport = new reportHarness.windowTarget.WebSocket("wss://room.test/ws/example");
  assert.equal(afterReport.readyState, MockWebSocket.CLOSED);
  assert.equal(MockWebSocket.created.length, 0, "confirmed report-and-block prevents stale signalling recreation");
  reportHarness.windowTarget.scheduleTurnRefresh(30000);
  assert.deepEqual(reportHarness.turnScheduleCalls, [], "report-and-block cannot resurrect TURN retries");
});

test("cancelled report confirmation does not terminate an otherwise live browser room", async () => {
  const {windowTarget, reportButton, turnScheduleCalls} = harness();
  reportButton.dispatch("click", {type: "click"});
  await Promise.resolve();
  const socket = new windowTarget.WebSocket("wss://room.test/ws/example");
  assert.equal(socket, MockWebSocket.created[0]);
  assert.equal(MockWebSocket.created.length, 1);
  windowTarget.scheduleTurnRefresh(30000);
  assert.deepEqual(turnScheduleCalls, [30000]);
});

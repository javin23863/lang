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
    let stopped = false;
    event.type ||= type;
    event.stopImmediatePropagation ||= () => { stopped = true; };
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener.call(this, event);
      if (stopped) return;
    }
    const propertyHandler = this[`on${type}`];
    if (!stopped && typeof propertyHandler === "function") propertyHandler.call(this, event);
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
    MockWebSocket.created.push(this);
  }

  startClosing() { this.readyState = MockWebSocket.CLOSING; }
  finishClose(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch("close", {code});
  }
  send() {}
}

class MockRTCPeerConnection {}

function element() {
  const target = new MockTarget();
  target.disabled = false;
  target.classList = {
    add() {},
    remove() {},
  };
  return target;
}

function harness() {
  MockWebSocket.created = [];
  const windowTarget = new MockTarget();
  windowTarget.fetch = async () => ({ok: true, status: 200});
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.RTCPeerConnection = MockRTCPeerConnection;
  windowTarget.LinguaNative = undefined;
  windowTarget.setTimeout = () => 1;
  windowTarget.clearTimeout = () => {};

  const elements = new Map([
    ["roleLocaleSel", element()],
    ["joinBtn", element()],
    ["roleCapability", element()],
    ["leaveBtn", element()],
    ["reportBtn", element()],
    ["qrBtn", element()],
  ]);
  const document = new MockTarget();
  const qrCore = new MockTarget();
  document.visibilityState = "visible";
  document.getElementById = id => elements.get(id) || null;
  document.createElement = tag => {
    assert.equal(tag, "script");
    return qrCore;
  };
  document.head = {appendChild() {}};

  const context = vm.createContext({
    window: windowTarget,
    navigator: {},
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
    Date,
    Map,
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(`
    let leaving = false;
    let explicitLeave = false;
    let terminalRoom = false;
    let disconnectCalls = 0;
    function disconnectRoom() {
      leaving = true;
      disconnectCalls++;
    }
    function suspendRoomForTest() { disconnectRoom(false); }
    function restoreRoomForTest(event) {
      if (event.persisted && !explicitLeave && !terminalRoom) leaving = false;
    }
    window.addEventListener('pagehide', suspendRoomForTest);
    window.addEventListener('pageshow', restoreRoomForTest);
    function roomSocketStateForTest() { return {leaving, disconnectCalls}; }
  `, context, {filename: "room-socket-globals.js"});
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    context,
    windowTarget,
    state: () => context.roomSocketStateForTest(),
  };
}

test("pre-suspension message is rejected after BFCache restore even before a fresh socket exists", () => {
  const h = harness();
  const oldSocket = new h.windowTarget.WebSocket("wss://room.test/ws/example");
  let oldMessages = 0;
  oldSocket.onmessage = () => { oldMessages++; };
  oldSocket.startClosing();

  h.windowTarget.dispatch("pagehide", {persisted: true});
  assert.equal(h.state().disconnectCalls, 1);
  assert.equal(h.state().leaving, true);
  h.windowTarget.dispatch("pageshow", {persisted: true});
  assert.equal(h.state().leaving, false, "room state is restored before the next socket necessarily exists");

  oldSocket.dispatch("message", {data: '{"type":"peer_join"}'});
  assert.equal(oldMessages, 0, "old-generation message cannot cross into the restored room");
});

test("old socket cannot close or feed the fresh restored socket after ownership changes", () => {
  const h = harness();
  const oldSocket = new h.windowTarget.WebSocket("wss://room.test/ws/example");
  oldSocket.startClosing();
  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});

  const freshSocket = new h.windowTarget.WebSocket("wss://room.test/ws/example");
  assert.notEqual(freshSocket, oldSocket);
  assert.equal(MockWebSocket.created.length, 2);

  let staleMessages = 0;
  let staleCloses = 0;
  oldSocket.onmessage = () => {
    staleMessages++;
    freshSocket.finishClose(1008);
  };
  oldSocket.onclose = () => { staleCloses++; };

  oldSocket.dispatch("message", {data: "malformed"});
  oldSocket.finishClose();
  assert.equal(staleMessages, 0, "stale message handler never gets a chance to close the fresh global socket");
  assert.equal(staleCloses, 0, "stale close handler cannot schedule a reconnect for the restored room");
  assert.notEqual(freshSocket.readyState, MockWebSocket.CLOSED);

  const coalesced = new h.windowTarget.WebSocket("wss://room.test/ws/example");
  assert.equal(coalesced, freshSocket, "stale close cannot clear ownership of the fresh socket");
  assert.equal(MockWebSocket.created.length, 2);
});

test("current-generation active socket still delivers messages and close events normally", () => {
  const h = harness();
  const socket = new h.windowTarget.WebSocket("wss://room.test/ws/example");
  let messages = 0;
  let closes = 0;
  socket.onmessage = () => { messages++; };
  socket.onclose = () => { closes++; };

  socket.dispatch("message", {data: "ok"});
  assert.equal(messages, 1);
  socket.finishClose();
  assert.equal(closes, 1);

  const replacement = new h.windowTarget.WebSocket("wss://room.test/ws/example");
  assert.notEqual(replacement, socket);
  assert.equal(MockWebSocket.created.length, 2);
});

test("source binds real browser sockets to a disconnect-invalidated generation before room handlers", () => {
  assert.match(source, /let browserRoomGeneration = 0/);
  assert.match(source, /function invalidateBrowserRoomGeneration\(\) \{[\s\S]*?browserRoomGeneration\+\+/);
  assert.match(source,
    /disconnectRoom = function mediaAwareDisconnectRoom[\s\S]*?invalidateBrowserRoomGeneration\(\)[\s\S]*?roomDisconnectRoom/);
  assert.match(source, /const socketGeneration = browserRoomGeneration/);
  assert.match(source,
    /socket\.addEventListener\("message", event => \{[\s\S]*?socketGeneration !== browserRoomGeneration[\s\S]*?activeRoomSocket !== socket[\s\S]*?stopImmediatePropagation/);
  assert.match(source,
    /socket\.addEventListener\("close", event => \{[\s\S]*?const stale = socketGeneration !== browserRoomGeneration[\s\S]*?activeRoomSocket !== socket[\s\S]*?stopImmediatePropagation/);
});

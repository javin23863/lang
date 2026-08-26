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
    let stopped = false;
    event.type ||= type;
    event.stopImmediatePropagation ||= () => { stopped = true; };
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener.call(this, event);
      if (stopped) return;
    }
    const propertyHandler = this[`on${type}`];
    if (!stopped && typeof propertyHandler === "function") return propertyHandler.call(this, event);
  }
}

class MockWebSocket extends MockTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = MockWebSocket.CONNECTING;
  }
  send() {}
}

class MockRTCPeerConnection extends MockTarget {
  static created = [];
  constructor() {
    super();
    this.iceConnectionState = "new";
    this.connectionState = "new";
    this.localDescription = {type: "offer", sdp: "mock"};
    this.pending = new Map();
    MockRTCPeerConnection.created.push(this);
  }
  defer(methodName) {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    this.pending.set(methodName, {promise, resolve, reject});
  }
  settle(methodName, value) { this.pending.get(methodName)?.resolve(value); }
  fail(methodName, error) { this.pending.get(methodName)?.reject(error); }
  setLocalDescription() { return this.pending.get("setLocalDescription")?.promise || Promise.resolve(); }
  setRemoteDescription() { return this.pending.get("setRemoteDescription")?.promise || Promise.resolve(); }
  addIceCandidate() { return this.pending.get("addIceCandidate")?.promise || Promise.resolve(); }
}

function element() {
  const target = new MockTarget();
  target.disabled = false;
  target.classList = {add() {}, remove() {}};
  return target;
}

function harness() {
  MockRTCPeerConnection.created = [];
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
  document.createElement = () => qrCore;
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
    Error,
    WeakMap,
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
    const peers = new Map();
    const sent = [];
    let handled = 0;
    let handleMode = 'ok';
    let releaseHandle;
    let handleBarrier = Promise.resolve();

    function resetHandleBarrier() {
      handleBarrier = new Promise(resolve => { releaseHandle = resolve; });
    }
    async function handle(message) {
      handled++;
      if (handleMode === 'wait-throw') {
        await handleBarrier;
        throw new Error('stale peer failure');
      }
      if (handleMode === 'throw') throw new Error('current peer failure');
      return message;
    }
    function send(message) { sent.push(message); }
    function disconnectRoom() {
      leaving = true;
      for (const state of peers.values()) state.pc.connectionState = 'closed';
      peers.clear();
    }
    window.addEventListener('pagehide', () => disconnectRoom(false));
    window.addEventListener('pageshow', event => {
      if (event.persisted && !explicitLeave && !terminalRoom) leaving = false;
    });

    function addPeer(id, pc) { peers.set(id, {pc}); }
    function removePeer(id) { peers.delete(id); }
    function setHandleMode(mode) { handleMode = mode; }
    function releaseHandleForTest() { releaseHandle?.(); }
    function stateForTest() { return {leaving, handled, sent: sent.map(item => JSON.stringify(item))}; }
  `, context, {filename: "room-peer-generation-globals.js"});

  vm.runInContext(source, context, {filename: "qr.js"});
  return {context, windowTarget, state: () => context.stateForTest()};
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test("current-generation peer operations, events, and signal sends remain live", async () => {
  const h = harness();
  const pc = new h.windowTarget.RTCPeerConnection();
  h.context.addPeer("p1", pc);

  let tracks = 0;
  pc.ontrack = () => { tracks++; };
  pc.dispatch("track", {streams: [{}]});
  await pc.setRemoteDescription({type: "offer"});
  h.context.send({type: "signal", to: "p1", data: {candidate: "c1"}});

  assert.equal(tracks, 1);
  assert.equal(h.state().sent.length, 1);
});

test("pending old-generation negotiation aborts after restore even if the peer id is reused", async () => {
  const h = harness();
  const oldPc = new h.windowTarget.RTCPeerConnection();
  oldPc.defer("setLocalDescription");
  h.context.addPeer("same-id", oldPc);

  const negotiation = (async () => {
    await oldPc.setLocalDescription();
    h.context.send({type: "signal", to: "same-id", data: {description: oldPc.localDescription}});
  })();

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});
  const freshPc = new h.windowTarget.RTCPeerConnection();
  h.context.addPeer("same-id", freshPc);
  oldPc.settle("setLocalDescription");

  await assert.rejects(negotiation, error =>
    error?.name === "AbortError" && error?.linguaPeerLifecycle === true);
  assert.equal(h.state().sent.length, 0,
    "stale SDP cannot be relayed through a fresh socket merely because a peer id was reused");
});

test("old peer events are blocked after restore while fresh peer events still run", () => {
  const h = harness();
  const oldPc = new h.windowTarget.RTCPeerConnection();
  h.context.addPeer("old", oldPc);
  let oldTracks = 0;
  oldPc.ontrack = () => { oldTracks++; };

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});
  oldPc.dispatch("track", {streams: [{}]});
  assert.equal(oldTracks, 0);

  const freshPc = new h.windowTarget.RTCPeerConnection();
  h.context.addPeer("fresh", freshPc);
  let freshTracks = 0;
  freshPc.ontrack = () => { freshTracks++; };
  freshPc.dispatch("track", {streams: [{}]});
  assert.equal(freshTracks, 1);
});

test("stale incoming-signal failure is swallowed after generation change instead of reaching websocket close logic", async () => {
  const h = harness();
  h.context.resetHandleBarrier();
  h.context.setHandleMode("wait-throw");
  const pending = h.context.handle({type: "signal"});

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});
  h.context.releaseHandleForTest();

  await assert.doesNotReject(pending);
  assert.equal(h.state().handled, 1);
});

test("current-generation handler failures are still surfaced", async () => {
  const h = harness();
  h.context.setHandleMode("throw");
  await assert.rejects(h.context.handle({type: "signal"}), /current peer failure/);
});

test("peer removal cancels a pending ICE operation without ending the whole room", async () => {
  const h = harness();
  const pc = new h.windowTarget.RTCPeerConnection();
  pc.defer("addIceCandidate");
  h.context.addPeer("p1", pc);

  const pending = pc.addIceCandidate({candidate: "candidate"});
  h.context.removePeer("p1");
  pc.settle("addIceCandidate");

  await assert.rejects(pending, error => error?.linguaPeerLifecycle === true);
  const freshPc = new h.windowTarget.RTCPeerConnection();
  h.context.addPeer("p2", freshPc);
  await assert.doesNotReject(freshPc.addIceCandidate({candidate: "fresh"}));
});

test("only branded peer lifecycle cancellation is suppressed as an unhandled rejection", () => {
  const h = harness();
  const branded = {reason: {linguaPeerLifecycle: true}, defaultPrevented: false};
  h.windowTarget.dispatch("unhandledrejection", branded);
  assert.equal(branded.defaultPrevented, true);

  const ordinary = {reason: new Error("ordinary"), defaultPrevented: false};
  h.windowTarget.dispatch("unhandledrejection", ordinary);
  assert.equal(ordinary.defaultPrevented, false);
});

test("source pins peer generation, async method guards, signal ownership, and stale handle error swallowing", () => {
  assert.match(source, /const RoomPeerConnection = window\.RTCPeerConnection/);
  assert.match(source, /const peerGenerations = new WeakMap\(\)/);
  assert.match(source, /function peerLifecycleAbortError\(\)[\s\S]*?linguaPeerLifecycle = true/);
  assert.match(source,
    /function peerConnectionActive\(pc,[\s\S]*?generation !== browserRoomGeneration[\s\S]*?state\?\.pc === pc/);
  assert.match(source,
    /handle = async function lifecycleAwareRoomHandle[\s\S]*?const generation = browserRoomGeneration[\s\S]*?linguaPeerLifecycle === true[\s\S]*?generation !== browserRoomGeneration/);
  assert.match(source,
    /send = function lifecycleAwareRoomSend[\s\S]*?message\?\.type === "signal"[\s\S]*?peers\.get\(message\.to\)[\s\S]*?peerConnectionActive\(state\.pc\)/);
  assert.match(source, /const guardedPeerMethods = \["setLocalDescription", "setRemoteDescription", "addIceCandidate"\]/);
  assert.match(source,
    /pc\[methodName\] = async[\s\S]*?!peerConnectionActive\(pc, generation\)[\s\S]*?await original[\s\S]*?!peerConnectionActive\(pc, generation\)/);
  assert.match(source,
    /window\.addEventListener\("unhandledrejection"[\s\S]*?event\.reason\?\.linguaPeerLifecycle === true[\s\S]*?preventDefault/);
});

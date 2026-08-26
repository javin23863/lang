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
    event.type ||= type;
    for (const listener of [...(this.listeners.get(type) || [])]) listener.call(this, event);
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
}

class MockRTCPeerConnection {}

class MockTrack {
  constructor(kind) {
    this.kind = kind;
    this.stopCount = 0;
  }
  stop() { this.stopCount++; }
}

class MockStream {
  constructor(...tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
}

function element() {
  const target = new MockTarget();
  target.disabled = false;
  target.classList = {
    values: new Set(),
    add(value) { this.values.add(value); },
    remove(value) { this.values.delete(value); },
    contains(value) { return this.values.has(value); },
  };
  return target;
}

function harness() {
  const windowTarget = new MockTarget();
  windowTarget.fetch = async () => ({ok: true, status: 200});
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.RTCPeerConnection = MockRTCPeerConnection;
  windowTarget.LinguaNative = undefined;
  const timers = [];
  windowTarget.setTimeout = (callback, delay) => {
    timers.push({callback, delay, cleared: false});
    return timers.length;
  };
  windowTarget.clearTimeout = id => {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  };

  const pendingMedia = [];
  const mediaDevices = {
    getUserMedia(constraints) {
      return new Promise((resolve, reject) => pendingMedia.push({constraints, resolve, reject}));
    },
  };
  const navigatorTarget = {mediaDevices};

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
    navigator: navigatorTarget,
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
    window.addEventListener('pagehide', suspendRoomForTest);
    function restoreRoomForTest() { leaving = false; }
    function explicitLeaveForTest() {
      explicitLeave = true;
      disconnectRoom(true);
    }
    function terminalCloseForTest() {
      terminalRoom = true;
      disconnectRoom(false);
    }
    function directDisconnectForTest() { disconnectRoom(false); }
    function roomMediaStateForTest() {
      return {leaving, explicitLeave, terminalRoom, disconnectCalls};
    }
  `, context, {filename: "room-media-globals.js"});
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    context,
    windowTarget,
    document,
    elements,
    pendingMedia,
    mediaDevices,
    state: () => context.roomMediaStateForTest(),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test("normal browser media acquisition is returned without stopping tracks", async () => {
  const h = harness();
  const audio = new MockTrack("audio");
  const stream = new MockStream(audio);
  const request = h.mediaDevices.getUserMedia({audio: true});
  assert.equal(h.pendingMedia.length, 1);
  h.pendingMedia[0].resolve(stream);

  assert.equal(await request, stream);
  assert.equal(audio.stopCount, 0);
});

test("disconnect invalidates a pending permission request and physically stops late tracks", async () => {
  const h = harness();
  const audio = new MockTrack("audio");
  const video = new MockTrack("video");
  const stream = new MockStream(audio, video);
  const request = h.mediaDevices.getUserMedia({audio: true, video: true});

  h.context.directDisconnectForTest();
  assert.equal(h.state().disconnectCalls, 1);
  h.pendingMedia[0].resolve(stream);

  await assert.rejects(request, error => error?.name === "AbortError");
  assert.equal(audio.stopCount, 1);
  assert.equal(video.stopCount, 1);
});

test("pagehide aborts old media but BFCache-style restore permits a fresh request", async () => {
  const h = harness();
  const staleTrack = new MockTrack("audio");
  const staleStream = new MockStream(staleTrack);
  const staleRequest = h.mediaDevices.getUserMedia({audio: true});

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.pendingMedia[0].resolve(staleStream);
  await assert.rejects(staleRequest, error => error?.name === "AbortError");
  assert.equal(staleTrack.stopCount, 1);

  await assert.rejects(
    h.mediaDevices.getUserMedia({audio: true}),
    error => error?.name === "AbortError",
    "new capture is blocked while the room remains suspended",
  );
  assert.equal(h.pendingMedia.length, 1, "suspended capture is rejected before platform permission I/O");

  h.context.restoreRoomForTest();
  h.windowTarget.dispatch("pageshow", {persisted: true});
  const freshTrack = new MockTrack("audio");
  const freshStream = new MockStream(freshTrack);
  const freshRequest = h.mediaDevices.getUserMedia({audio: true});
  assert.equal(h.pendingMedia.length, 2);
  h.pendingMedia[1].resolve(freshStream);
  assert.equal(await freshRequest, freshStream);
  assert.equal(freshTrack.stopCount, 0);
});

test("explicit Leave and terminal room close permanently block later browser capture", async () => {
  const leave = harness();
  leave.context.explicitLeaveForTest();
  await assert.rejects(
    leave.mediaDevices.getUserMedia({audio: true}),
    error => error?.name === "AbortError",
  );
  assert.equal(leave.pendingMedia.length, 0);

  const terminal = harness();
  terminal.context.terminalCloseForTest();
  await assert.rejects(
    terminal.mediaDevices.getUserMedia({video: true}),
    error => error?.name === "AbortError",
  );
  assert.equal(terminal.pendingMedia.length, 0);
});

test("confirmed report invalidates pending media before its async leave completes", async () => {
  const h = harness();
  const track = new MockTrack("audio");
  const stream = new MockStream(track);
  const request = h.mediaDevices.getUserMedia({audio: true});
  const report = h.elements.get("reportBtn");
  report.addEventListener("click", () => { report.disabled = true; });

  report.dispatch("click", {});
  await settle();
  h.pendingMedia[0].resolve(stream);

  await assert.rejects(request, error => error?.name === "AbortError");
  assert.equal(track.stopCount, 1);
  await assert.rejects(
    h.mediaDevices.getUserMedia({audio: true}),
    error => error?.name === "AbortError",
    "report-and-leave permanently closes the media lifecycle immediately after confirmation",
  );
  assert.equal(h.pendingMedia.length, 1);
});

test("cancelled report does not invalidate an otherwise valid pending permission", async () => {
  const h = harness();
  const track = new MockTrack("audio");
  const stream = new MockStream(track);
  const request = h.mediaDevices.getUserMedia({audio: true});

  h.elements.get("reportBtn").dispatch("click", {});
  await settle();
  h.pendingMedia[0].resolve(stream);

  assert.equal(await request, stream);
  assert.equal(track.stopCount, 0);
});

test("source binds browser media requests to room lifecycle generation and teardown state", () => {
  assert.match(source, /let browserMediaGeneration = 0/);
  assert.match(source, /let browserMediaLifecycleEnded = false/);
  assert.match(source, /const originalGetUserMedia = mediaDevices\.getUserMedia\.bind\(mediaDevices\)/);
  assert.match(source,
    /const generation = browserMediaGeneration;[\s\S]*?await originalGetUserMedia\(constraints\)[\s\S]*?generation !== browserMediaGeneration/);
  assert.match(source,
    /generation !== browserMediaGeneration[\s\S]*?stopCapturedBrowserStream\(stream\)[\s\S]*?"AbortError"/);
  assert.match(source, /typeof leaving !== "undefined" && leaving/);
  assert.match(source, /typeof explicitLeave !== "undefined" && explicitLeave/);
  assert.match(source, /typeof terminalRoom !== "undefined" && terminalRoom/);
  assert.match(source,
    /disconnectRoom = function mediaAwareDisconnectRoom[\s\S]*?invalidatePendingBrowserMedia\(\)[\s\S]*?roomDisconnectRoom/);
  assert.match(source,
    /function endRoomLifecycle\(preserveReportRequest = false\) \{[\s\S]*?browserMediaLifecycleEnded = true;[\s\S]*?invalidatePendingBrowserMedia\(\)/);
});

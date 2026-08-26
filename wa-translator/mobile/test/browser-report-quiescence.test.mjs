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
    this.disabled = false;
    this.classList = {
      values: new Set(),
      add: value => this.classList.values.add(value),
      remove: value => this.classList.values.delete(value),
      contains: value => this.classList.values.has(value),
    };
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
  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = MockWebSocket.OPEN;
    this.closeCount = 0;
  }
  close() {
    this.closeCount++;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch("close", {type: "close", stopImmediatePropagation() {}});
  }
  send() {}
}

class MockRTCPeerConnection {}

function harness() {
  const windowTarget = new MockTarget();
  const reportButton = new MockTarget();
  const leaveButton = new MockTarget();
  const qrButton = new MockTarget();
  const micButton = new MockTarget();
  const camButton = new MockTarget();
  const voiceButton = new MockTarget();
  const qrScript = new MockTarget();

  const elements = new Map([
    ["reportBtn", reportButton],
    ["leaveBtn", leaveButton],
    ["qrBtn", qrButton],
    ["micBtn", micButton],
    ["camBtn", camButton],
    ["voiceBtn", voiceButton],
  ]);
  const document = new MockTarget();
  document.visibilityState = "visible";
  document.getElementById = id => elements.get(id) || null;
  document.createElement = () => qrScript;
  document.head = {appendChild() {}};

  const fetchCalls = [];
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

  const localTrack = {stopCount: 0, stop() { this.stopCount++; }};
  const peer = {closeCount: 0, close() { this.closeCount++; }};
  const roomState = {
    localTrack,
    peer,
    mediaStream: {getTracks: () => [localTrack]},
    peers: new Map([["peer-1", {pc: peer}]]),
    audioDisconnects: 0,
    audioCloses: 0,
    micEnabled: true,
    camOn: true,
    chatEnabled: true,
    failVoiceCalls: 0,
    endCallKeys: [],
  };

  const context = vm.createContext({
    window: windowTarget,
    document,
    navigator: {mediaDevices: null},
    roomState,
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
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(`
    let mediaStream = roomState.mediaStream;
    let audioMediaPromise = Promise.resolve(roomState.mediaStream);
    let videoMediaPromise = Promise.resolve(roomState.mediaStream);
    let audioInputNode = {disconnect() { roomState.audioDisconnects++; }};
    let workletNode = {port: {postMessage() {}}};
    let audioCtx = {close() { roomState.audioCloses++; return Promise.resolve(); }};
    let peers = roomState.peers;
    let micOn = true;
    let camOn = true;
    let leaving = false;
    let explicitLeave = false;
    let terminalRoom = false;
    function setMicEnabled(value) {
      micOn = value;
      roomState.micEnabled = value;
    }
    function setChatEnabled(value) { roomState.chatEnabled = value; }
    function failVoice() { roomState.failVoiceCalls++; }
    function endCall(key) { roomState.endCallKeys.push(key); }
    function reportQuiescenceStateForTest() {
      return {
        mediaStream,
        audioMediaPromise,
        videoMediaPromise,
        audioInputNode,
        workletNode,
        audioCtx,
        peersSize: peers.size,
        micOn,
        camOn,
        leaving,
      };
    }
  `, context, {filename: "room-report-state.js"});
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    windowTarget,
    reportButton,
    leaveButton,
    micButton,
    camButton,
    voiceButton,
    fetchCalls,
    roomState,
    state: () => context.reportQuiescenceStateForTest(),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test("confirmed report immediately quiesces local room media while preserving report delivery and socket registration", async () => {
  const h = harness();
  const socket = new h.windowTarget.WebSocket("wss://room.test/ws/example");
  let reportRequest;
  h.reportButton.addEventListener("click", () => {
    h.reportButton.disabled = true;
    reportRequest = h.windowTarget.fetch("https://room.test/api/reports", {method: "POST"});
  });

  h.reportButton.dispatch("click", {type: "click"});
  await settle();

  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0].init.signal.aborted, false,
    "report request remains alive for server-side participant authorization");
  assert.equal(socket.closeCount, 0,
    "participant-registration socket remains open until the report finishes and normal Leave runs");
  assert.equal(h.roomState.localTrack.stopCount, 1, "camera/microphone hardware stops immediately");
  assert.equal(h.roomState.peer.closeCount, 1, "remote peer media is closed immediately");
  assert.equal(h.roomState.audioDisconnects, 1, "caption audio input is disconnected");
  assert.equal(h.roomState.audioCloses, 1, "browser audio graph is closed");
  assert.equal(h.roomState.micEnabled, false);
  assert.equal(h.roomState.chatEnabled, false);
  assert.equal(h.roomState.failVoiceCalls, 1, "translated/fallback speech is retired");
  assert.deepEqual(h.roomState.endCallKeys, ["call.ended"]);
  assert.equal(h.micButton.disabled, true);
  assert.equal(h.camButton.disabled, true);
  assert.equal(h.voiceButton.disabled, true);
  assert.equal(h.leaveButton.disabled, true,
    "a second user Leave cannot abort the already-confirmed report delivery");

  const state = h.state();
  assert.equal(state.mediaStream, null);
  assert.equal(state.audioMediaPromise, null);
  assert.equal(state.videoMediaPromise, null);
  assert.equal(state.audioInputNode, null);
  assert.equal(state.workletNode, null);
  assert.equal(state.audioCtx, null);
  assert.equal(state.peersSize, 0);
  assert.equal(state.micOn, false);
  assert.equal(state.camOn, false);
  assert.equal(state.leaving, false,
    "quiescence must not mark the room leaving before report authorization finishes");

  h.fetchCalls[0].resolve({ok: true, status: 204});
  assert.equal((await reportRequest).ok, true);
});

test("cancelled report does not quiesce an otherwise live room", async () => {
  const h = harness();
  const socket = new h.windowTarget.WebSocket("wss://room.test/ws/example");
  h.reportButton.dispatch("click", {type: "click"});
  await settle();

  assert.equal(h.fetchCalls.length, 0);
  assert.equal(socket.closeCount, 0);
  assert.equal(h.roomState.localTrack.stopCount, 0);
  assert.equal(h.roomState.peer.closeCount, 0);
  assert.equal(h.roomState.audioDisconnects, 0);
  assert.equal(h.roomState.audioCloses, 0);
  assert.equal(h.roomState.micEnabled, true);
  assert.equal(h.roomState.chatEnabled, true);
  assert.equal(h.micButton.disabled, false);
  assert.equal(h.camButton.disabled, false);
  assert.equal(h.voiceButton.disabled, false);
  assert.equal(h.leaveButton.disabled, false);
});

test("source keeps confirmed-report quiescence local and preserves the later normal Leave path", () => {
  assert.match(source, /function quiesceRoomForReport\(\)/);
  assert.match(source, /stopCapturedBrowserStream\(mediaStream\)/);
  assert.match(source, /for \(const state of peers\.values\(\)\)[\s\S]*?state\?\.pc\?\.close\?\.\(\)/);
  assert.match(source, /audioInputNode\.disconnect\(\)[\s\S]*?audioInputNode = null/);
  assert.match(source, /Promise\.resolve\(context\.close\(\)\)\.catch/);
  assert.match(source, /setChatEnabled\(false\)/);
  assert.match(source, /if \(reportButton\.disabled\) \{[\s\S]*?quiesceRoomForReport\(\);[\s\S]*?endRoomLifecycle\(true\)/);
  const start = source.indexOf("function quiesceRoomForReport()");
  const end = source.indexOf("function canRetryCapabilities()", start);
  assert.ok(start >= 0 && end > start);
  const quiescenceSource = source.slice(start, end);
  assert.doesNotMatch(quiescenceSource, /disconnectRoom\(/,
    "report quiescence must not run normal disconnect before the backend authenticates the participant");
});

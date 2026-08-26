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
    let stopped = false;
    event.type ||= type;
    event.stopImmediatePropagation ||= () => { stopped = true; };
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener.call(this, event);
      if (stopped) return;
    }
    const propertyHandler = this[`on${type}`];
    if (!stopped && typeof propertyHandler === "function") return propertyHandler.call(this, event);
  }
  setAttribute(name, value) { this[name] = String(value); }
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
  constructor() {
    super();
    this.iceConnectionState = "new";
    this.connectionState = "new";
  }
}

class MockAudioInput {
  constructor(context, stream) {
    this.context = context;
    this.stream = stream;
    this.connectedTo = null;
    this.disconnectCalls = 0;
  }
  connect(node) { this.connectedTo = node; }
  disconnect() { this.disconnectCalls++; this.connectedTo = null; }
}

class MockAudioContext {
  static created = [];
  static plans = [];
  constructor() {
    this.plan = MockAudioContext.plans.shift() || {};
    this.state = this.plan.state || "running";
    this.closed = false;
    this.addModuleCalls = [];
    this.inputs = [];
    this.audioWorklet = {
      addModule: path => {
        this.addModuleCalls.push(path);
        return this.plan.addModule?.promise || Promise.resolve();
      },
    };
    MockAudioContext.created.push(this);
  }
  createMediaStreamSource(stream) {
    const input = new MockAudioInput(this, stream);
    this.inputs.push(input);
    return input;
  }
  async resume() {
    if (this.plan.resume) await this.plan.resume.promise;
    this.state = "running";
  }
  close() { this.closed = true; this.state = "closed"; return Promise.resolve(); }
}

class MockAudioWorkletNode {
  static created = [];
  constructor(context, name) {
    this.context = context;
    this.name = name;
    this.port = {onmessage: null, messages: []};
    MockAudioWorkletNode.created.push(this);
  }
}

class MockFallbackAudio {
  constructor() {
    this.src = "";
    this.volume = 1;
    this.pauseCalls = 0;
    this.removeCalls = 0;
    this.playCalls = 0;
    this.nextPlay = null;
  }
  deferNextPlay() {
    const gate = deferred();
    this.nextPlay = gate;
    return gate;
  }
  play() {
    this.playCalls++;
    if (!this.nextPlay) return Promise.resolve("played");
    const gate = this.nextPlay;
    this.nextPlay = null;
    return gate.promise;
  }
  pause() { this.pauseCalls++; }
  removeAttribute(name) {
    if (name === "src") this.src = "";
    this.removeCalls++;
  }
}

function element() {
  const target = new MockTarget();
  target.disabled = false;
  target.classList = {add() {}, remove() {}};
  return target;
}

function harness() {
  MockAudioContext.created = [];
  MockAudioContext.plans = [];
  MockAudioWorkletNode.created = [];

  const windowTarget = new MockTarget();
  windowTarget.fetch = async () => ({ok: true, status: 200});
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.RTCPeerConnection = MockRTCPeerConnection;
  windowTarget.AudioContext = MockAudioContext;
  windowTarget.AudioWorkletNode = MockAudioWorkletNode;
  windowTarget.LinguaNative = undefined;
  windowTarget.setTimeout = () => 1;
  windowTarget.clearTimeout = () => {};

  const elements = new Map([
    ["roleLocaleSel", element()],
    ["joinBtn", element()],
    ["roleCapability", element()],
    ["leaveBtn", element()],
    ["reportBtn", element()],
    ["micBtn", element()],
    ["qrBtn", element()],
  ]);
  const document = new MockTarget();
  const qrCore = new MockTarget();
  document.visibilityState = "visible";
  document.getElementById = id => elements.get(id) || null;
  document.createElement = () => qrCore;
  document.head = {appendChild() {}};

  const fallbackAudio = new MockFallbackAudio();
  const context = vm.createContext({
    window: windowTarget,
    navigator: {},
    document,
    providedFallbackAudio: fallbackAudio,
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
    WebSocket: MockWebSocket,
  });

  vm.runInContext(`
    let leaving = false;
    let explicitLeave = false;
    let terminalRoom = false;
    let mediaStream = {id: 'initial-stream'};
    let audioCtx = null;
    let audioInputNode = null;
    let workletNode = null;
    let micOn = false;
    let asrPaused = false;
    let myLocale = 'en-US';
    let ws = {readyState: WebSocket.OPEN, sent: [], send(value) { this.sent.push(value); }};
    const peers = new Map();
    const statusCalls = [];
    const micStates = [];
    let audioUnlocked = false;
    const fallbackAudio = providedFallbackAudio;
    const SILENT_WAV = 'silent-wav';
    let mediaCounter = 0;

    function getAudioMedia() {
      mediaStream = {id: 'stream-' + (++mediaCounter)};
      return Promise.resolve(mediaStream);
    }
    async function startCapture() { throw new Error('room startCapture should be replaced'); }
    function setMicEnabled(on) { micOn = on; micStates.push(on); }
    function setStatus(key) { statusCalls.push(key); }
    function t(key) { return key; }
    function spokenLocaleName(id) { return id; }
    function addTracks() {}
    function unlockFallbackAudio() {
      if (audioUnlocked) return;
      fallbackAudio.src = SILENT_WAV;
      fallbackAudio.volume = 0;
      fallbackAudio.play().then(() => {
        audioUnlocked = true;
        fallbackAudio.pause();
        fallbackAudio.removeAttribute('src');
        fallbackAudio.volume = 1;
      }).catch(() => {});
    }
    function disconnectRoom() {
      if (leaving) return;
      leaving = true;
      micOn = false;
      peers.clear();
      if (audioInputNode) audioInputNode.disconnect();
      audioInputNode = null;
      workletNode = null;
      if (audioCtx) audioCtx.close().catch(() => {});
      audioCtx = null;
      ws = null;
    }
    window.addEventListener('pagehide', () => disconnectRoom(false));
    window.addEventListener('pageshow', event => {
      if (event.persisted && !explicitLeave && !terminalRoom) leaving = false;
    });

    function installFreshWsForTest() {
      ws = {readyState: WebSocket.OPEN, sent: [], send(value) { this.sent.push(value); }};
    }
    function stateForTest() {
      return {
        leaving,
        micOn,
        audioUnlocked,
        statusCalls: [...statusCalls],
        micStates: [...micStates],
        audioCtx,
        audioInputNode,
        workletNode,
        wsSent: ws ? [...ws.sent] : [],
      };
    }
  `, context, {filename: "room-audio-globals.js"});
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    context,
    windowTarget,
    elements,
    fallbackAudio,
    state: () => context.stateForTest(),
    installFreshWs: () => context.installFreshWsForTest(),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("active browser mic start builds one audio graph and current PCM reaches signalling", async () => {
  const h = harness();
  await h.elements.get("micBtn").onclick();

  const state = h.state();
  assert.equal(MockAudioContext.created.length, 1);
  assert.equal(MockAudioWorkletNode.created.length, 1);
  assert.equal(state.micOn, true);
  assert.equal(state.statusCalls.at(-1), "status.micOn");
  assert.equal(state.audioInputNode.connectedTo, state.workletNode);

  state.workletNode.port.onmessage({data: "pcm-current"});
  assert.deepEqual(Array.from(h.state().wsSent), ["pcm-current"]);
});

test("pending worklet load cannot attach to a fresh restored audio graph or disable its mic", async () => {
  const h = harness();
  const oldAddModule = deferred();
  MockAudioContext.plans.push({addModule: oldAddModule});
  const oldClick = h.elements.get("micBtn").onclick();
  await settle();
  const oldContext = MockAudioContext.created[0];
  assert.equal(oldContext.addModuleCalls.length, 1);

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});
  h.installFreshWs();
  MockAudioContext.plans.push({});
  await h.elements.get("micBtn").onclick();
  const freshState = h.state();
  const freshContext = MockAudioContext.created[1];
  const freshNode = freshState.workletNode;
  assert.equal(freshState.micOn, true);
  assert.equal(freshState.audioCtx, freshContext);

  oldAddModule.resolve();
  await oldClick;
  await settle();

  const finalState = h.state();
  assert.equal(finalState.micOn, true, "stale mic continuation cannot turn the fresh mic off");
  assert.equal(finalState.audioCtx, freshContext);
  assert.equal(finalState.workletNode, freshNode);
  assert.equal(MockAudioWorkletNode.created.length, 1,
    "old addModule completion is rejected before constructing a stale worklet");
  assert.equal(finalState.statusCalls.includes("status.micUnavailable"), false);
});

test("pending AudioContext resume cannot mutate fresh restored audio state", async () => {
  const h = harness();
  const oldResume = deferred();
  MockAudioContext.plans.push({state: "suspended", resume: oldResume});
  const oldClick = h.elements.get("micBtn").onclick();
  await settle();
  const oldContext = MockAudioContext.created[0];
  const oldNode = MockAudioWorkletNode.created[0];
  assert.equal(oldContext.inputs.length, 1);

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});
  h.installFreshWs();
  MockAudioContext.plans.push({});
  await h.elements.get("micBtn").onclick();
  const freshContext = MockAudioContext.created[1];
  const freshNode = h.state().workletNode;

  oldResume.resolve();
  await oldClick;
  await settle();

  const state = h.state();
  assert.equal(state.micOn, true);
  assert.equal(state.audioCtx, freshContext);
  assert.equal(state.workletNode, freshNode);
  assert.notEqual(state.workletNode, oldNode);
  assert.equal(state.statusCalls.includes("status.micUnavailable"), false);
});

test("old worklet PCM cannot cross a room generation while fresh worklet PCM still sends", async () => {
  const h = harness();
  await h.elements.get("micBtn").onclick();
  const oldNode = h.state().workletNode;

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});
  h.installFreshWs();
  await h.elements.get("micBtn").onclick();
  const freshNode = h.state().workletNode;

  oldNode.port.onmessage({data: "pcm-stale"});
  assert.deepEqual(Array.from(h.state().wsSent), []);
  freshNode.port.onmessage({data: "pcm-fresh"});
  assert.deepEqual(Array.from(h.state().wsSent), ["pcm-fresh"]);
});

test("same-generation parallel starts coalesce onto one context and worklet", async () => {
  const h = harness();
  const addModule = deferred();
  MockAudioContext.plans.push({addModule});

  const first = h.context.startCapture();
  const second = h.context.startCapture();
  assert.equal(first, second);
  await settle();
  assert.equal(MockAudioContext.created.length, 1);

  addModule.resolve();
  await Promise.all([first, second]);
  assert.equal(MockAudioWorkletNode.created.length, 1);
});

test("current-generation worklet load failure still reports microphone unavailable", async () => {
  const h = harness();
  const addModule = deferred();
  MockAudioContext.plans.push({addModule});
  const click = h.elements.get("micBtn").onclick();
  await settle();
  addModule.reject(new Error("worklet load failed"));
  await click;

  const state = h.state();
  assert.equal(state.micOn, false);
  assert.equal(state.statusCalls.at(-1), "status.micUnavailable");
});

test("late silent audio unlock completion cannot pause or clear fresh fallback TTS", async () => {
  const h = harness();
  const oldPlay = h.fallbackAudio.deferNextPlay();
  h.context.unlockFallbackAudio();
  await settle();
  assert.equal(h.fallbackAudio.src, "silent-wav");

  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});
  h.fallbackAudio.src = "blob:fresh-tts";
  h.fallbackAudio.volume = 1;
  await h.fallbackAudio.play();
  const pauseBeforeOldCompletion = h.fallbackAudio.pauseCalls;
  const removeBeforeOldCompletion = h.fallbackAudio.removeCalls;

  oldPlay.resolve("old-unlock-finished");
  await settle();

  assert.equal(h.fallbackAudio.pauseCalls, pauseBeforeOldCompletion,
    "stale unlock then-handler cannot pause fresh TTS");
  assert.equal(h.fallbackAudio.removeCalls, removeBeforeOldCompletion,
    "stale unlock then-handler cannot remove fresh TTS source");
  assert.equal(h.fallbackAudio.src, "blob:fresh-tts");
  assert.equal(h.state().audioUnlocked, false,
    "stale unlock completion is rejected before marking the fresh generation unlocked");
});

test("current-generation fallback audio play still resolves normally", async () => {
  const h = harness();
  await assert.doesNotReject(h.fallbackAudio.play());
});

test("source pins generation-aware browser audio setup, PCM delivery, mic completion, and shared-audio play", () => {
  assert.match(source, /let browserAudioStartPromise = null/);
  assert.match(source, /let browserAudioStartGeneration = -1/);
  assert.match(source, /function audioLifecycleAbortError\(\)[\s\S]*?linguaAudioLifecycle = true/);
  assert.match(source,
    /startCapture = function lifecycleAwareStartCapture\(\)[\s\S]*?browserAudioStartGeneration === browserRoomGeneration[\s\S]*?const generation = browserRoomGeneration/);
  assert.match(source, /const stream = await getAudioMedia\(\)/);
  assert.match(source, /let context = audioCtx/);
  assert.match(source, /await context\.audioWorklet\.addModule\("\/static\/pcm-worklet\.js"\)/);
  assert.match(source, /audioCtx !== context/);
  assert.match(source,
    /node\.port\.onmessage = event => \{[\s\S]*?generation !== browserRoomGeneration[\s\S]*?workletNode !== node[\s\S]*?ws\.send\(event\.data\)/);
  assert.match(source,
    /micButton\.onclick = async \(\) => \{[\s\S]*?const generation = browserRoomGeneration[\s\S]*?await startCapture\(\)[\s\S]*?generation !== browserRoomGeneration[\s\S]*?linguaAudioLifecycle/);
  assert.match(source,
    /fallbackAudio\.play = \(\.\.\.args\) => \{[\s\S]*?const generation = browserRoomGeneration[\s\S]*?roomFallbackPlay[\s\S]*?audioLifecycleAbortError\(\)/);
});

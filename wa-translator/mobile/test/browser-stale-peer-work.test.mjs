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
    let handledMessages = 0;
    let peerCreates = 0;
    const peers = new Map();
    const videoNotes = [];

    async function handle(message) {
      handledMessages++;
      if (message.type === 'peer_join') {
        peerCreates++;
        peers.set(message.id, {pc: {
          iceConnectionState: message.iceState || 'new',
          connectionState: message.connectionState || 'new',
        }});
      }
    }

    function showVideoNote(key) { videoNotes.push(key); }

    // Registered before deferred qr.js, matching room.html's real ordering.
    window.addEventListener('pagehide', () => {
      leaving = true;
      peers.clear();
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted && !explicitLeave && !terminalRoom) leaving = false;
    });

    function setTerminalForTest() { terminalRoom = true; }
    function stateForTest() {
      return {
        leaving,
        explicitLeave,
        terminalRoom,
        handledMessages,
        peerCreates,
        peerCount: peers.size,
        videoNotes: [...videoNotes],
      };
    }
  `, context, {filename: "room-peer-globals.js"});
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    context,
    windowTarget,
    elements,
    state: () => context.stateForTest(),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test("active browser room still handles normal peer messages", async () => {
  const h = harness();
  await h.context.handle({type: "peer_join", id: "p1"});

  const state = h.state();
  assert.equal(state.handledMessages, 1);
  assert.equal(state.peerCreates, 1);
  assert.equal(state.peerCount, 1);
});

test("queued peer message after pagehide cannot recreate a cleared peer", async () => {
  const h = harness();
  await h.context.handle({type: "peer_join", id: "old"});
  assert.equal(h.state().peerCount, 1);

  h.windowTarget.dispatch("pagehide", {persisted: true});
  assert.equal(h.state().peerCount, 0);
  await h.context.handle({type: "peer_join", id: "queued"});

  const suspended = h.state();
  assert.equal(suspended.handledMessages, 1, "stale message never reaches the room handler");
  assert.equal(suspended.peerCreates, 1, "stale message cannot call startPeer-equivalent work");
  assert.equal(suspended.peerCount, 0);
});

test("BFCache restore re-enables server-message handling for the fresh room generation", async () => {
  const h = harness();
  h.windowTarget.dispatch("pagehide", {persisted: true});
  await h.context.handle({type: "peer_join", id: "blocked"});
  assert.equal(h.state().peerCreates, 0);

  h.windowTarget.dispatch("pageshow", {persisted: true});
  await settle();
  await h.context.handle({type: "peer_join", id: "fresh"});

  const restored = h.state();
  assert.equal(restored.leaving, false);
  assert.equal(restored.handledMessages, 1);
  assert.equal(restored.peerCreates, 1);
  assert.equal(restored.peerCount, 1);
});

test("explicit Leave permanently blocks queued room messages but preserves the intended terminal note", async () => {
  const h = harness();
  h.elements.get("leaveBtn").dispatch("click", {});
  await h.context.handle({type: "peer_join", id: "late"});
  h.context.showVideoNote("note.videoSlow");
  h.context.showVideoNote("note.youLeft");

  const state = h.state();
  assert.equal(state.handledMessages, 0);
  assert.equal(state.peerCreates, 0);
  assert.deepEqual(Array.from(state.videoNotes), ["note.youLeft"],
    "stale peer warning is suppressed but the room's terminal Leave note still renders");
});

test("terminal room state blocks later server messages even without a user Leave click", async () => {
  const h = harness();
  h.context.setTerminalForTest();
  await h.context.handle({type: "peer_join", id: "late"});
  assert.equal(h.state().handledMessages, 0);
  assert.equal(h.state().peerCreates, 0);
});

test("peer warning notes require a current unhealthy peer and cannot overwrite healthy or empty state", async () => {
  const h = harness();

  h.context.showVideoNote("note.videoSlow");
  assert.deepEqual(Array.from(h.state().videoNotes), [],
    "old timer cannot warn after its peer has disappeared");

  await h.context.handle({type: "peer_join", id: "p1", iceState: "checking"});
  h.context.showVideoNote("note.videoSlow");
  assert.deepEqual(Array.from(h.state().videoNotes), ["note.videoSlow"],
    "a current unhealthy peer keeps the existing warning behavior");

  vm.runInContext("peers.get('p1').pc.iceConnectionState = 'connected'", h.context);
  h.context.showVideoNote("note.videoFailed");
  assert.deepEqual(Array.from(h.state().videoNotes), ["note.videoSlow"],
    "an old failed callback cannot overwrite a healthy current peer state");
});

test("source wraps room messages and peer warning notes behind browser lifecycle state", () => {
  assert.match(source, /const PEER_NETWORK_NOTE_KEYS = new Set\(\["note\.videoSlow", "note\.videoFailed"\]\)/);
  assert.match(source,
    /function browserRoomGenerationActive\(generation\)[\s\S]*?generation !== browserRoomGeneration \|\| roomSuspended \|\| roomLifecycleEnded[\s\S]*?leaving[\s\S]*?explicitLeave/);
  assert.match(source,
    /function browserRoomWorkActive\(\)[\s\S]*?!browserRoomGenerationActive\(browserRoomGeneration\)[\s\S]*?terminalRoom/);
  assert.match(source,
    /const roomHandle = handle;[\s\S]*?handle = async function lifecycleAwareRoomHandle[\s\S]*?!browserRoomWorkActive\(\)/);
  assert.match(source,
    /const roomShowVideoNote = showVideoNote;[\s\S]*?PEER_NETWORK_NOTE_KEYS\.has\(key\)[\s\S]*?currentPeerNeedsNetworkNote\(\)/);
  assert.match(source, /pc\.iceConnectionState === "connected"/);
  assert.match(source, /pc\.iceConnectionState === "completed"/);
  assert.match(source, /pc\.connectionState === "connected"/);
});

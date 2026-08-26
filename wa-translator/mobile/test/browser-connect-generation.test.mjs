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
  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({listener, capture: options === true || options?.capture === true});
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(item => item.listener !== listener));
  }
  dispatch(type, event = {}) {
    event.type ||= type;
    const listeners = [...(this.listeners.get(type) || [])];
    for (const phase of [true, false]) {
      for (const item of listeners) {
        if (item.capture === phase) item.listener.call(this, event);
      }
    }
  }
}

class MockWebSocket extends MockTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static created = [];
  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = MockWebSocket.CONNECTING;
    this.binaryType = "blob";
    MockWebSocket.created.push(this);
  }
  close() { this.readyState = MockWebSocket.CLOSED; }
  send() {}
}

class MockRTCPeerConnection extends MockTarget {}

function response(status, bodyGate = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => bodyGate ? bodyGate.promise : Promise.resolve({}),
  };
}

async function waitFor(predicate, message = "condition") {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(`timed out waiting for ${message}`);
}

function harness() {
  MockWebSocket.created = [];
  const windowTarget = new MockTarget();
  windowTarget.window = windowTarget;
  windowTarget.LinguaNative = undefined;
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.RTCPeerConnection = MockRTCPeerConnection;
  windowTarget.URL = URL;
  windowTarget.Request = Request;
  windowTarget.AbortController = AbortController;
  windowTarget.DOMException = DOMException;
  windowTarget.EventTarget = EventTarget;
  windowTarget.Proxy = Proxy;
  windowTarget.Reflect = Reflect;
  windowTarget.Date = Date;
  windowTarget.Promise = Promise;
  windowTarget.Map = Map;
  windowTarget.WeakMap = WeakMap;
  windowTarget.Error = Error;
  windowTarget.queueMicrotask = queueMicrotask;
  windowTarget.location = {
    pathname: "/room/example",
    origin: "https://room.test",
    href: "https://room.test/room/example",
  };

  let timerId = 0;
  const timers = new Map();
  windowTarget.setTimeout = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, {callback, delay});
    return id;
  };
  windowTarget.clearTimeout = id => timers.delete(id);
  windowTarget.setInterval = () => ++timerId;
  windowTarget.clearInterval = () => {};

  const leaveButton = new MockTarget();
  const reportButton = new MockTarget();
  const qrButton = new MockTarget();
  const qrScript = new MockTarget();
  reportButton.disabled = false;
  qrButton.disabled = false;
  const elements = new Map([
    ["leaveBtn", leaveButton],
    ["reportBtn", reportButton],
    ["qrBtn", qrButton],
  ]);
  const document = new MockTarget();
  document.visibilityState = "visible";
  document.getElementById = id => elements.get(id) || null;
  document.createElement = () => qrScript;
  document.head = {appendChild() {}};
  windowTarget.document = document;

  const fetchCalls = [];
  const nativeFetch = (input, init = {}) => {
    const gate = deferred();
    const call = {input: String(input), init, gate, settled: false};
    fetchCalls.push(call);
    const rejectAbort = () => {
      if (call.settled) return;
      call.settled = true;
      gate.reject(new DOMException("aborted", "AbortError"));
    };
    if (init.signal?.aborted) rejectAbort();
    else init.signal?.addEventListener("abort", rejectAbort, {once: true});
    call.respond = value => {
      if (call.settled) return;
      call.settled = true;
      gate.resolve(value);
    };
    return gate.promise;
  };
  windowTarget.fetch = nativeFetch;

  const context = vm.createContext(windowTarget);
  vm.runInContext(`
    let leaving = false;
    let explicitLeave = false;
    let terminalRoom = false;
    let roleChosen = true;
    let roomFull = false;
    let ws = null;
    let iceServers = [{urls: ['stun:initial']}];
    let iceExpiresAt = 0;
    let iceRefreshPromise = null;
    let turnRefreshTimer = null;
    const appliedIce = [];
    const turnSchedules = [];
    let restoreConnectPromise = null;

    function scheduleTurnRefresh(delay) {
      turnRefreshTimer = Number(delay);
      turnSchedules.push(Number(delay));
    }
    window.scheduleTurnRefresh = scheduleTurnRefresh;

    function applyIceServersToPeers() {
      appliedIce.push(iceServers[0]?.urls || null);
    }

    async function refreshIceServers(force = false) {
      if (!force && Date.now() < iceExpiresAt - 60000) {
        scheduleTurnRefresh(iceExpiresAt - Date.now() - 60000);
        return;
      }
      if (iceRefreshPromise) return iceRefreshPromise;
      iceRefreshPromise = (async () => {
        try {
          const reply = await window.fetch('https://room.test/api/turn', {
            headers: {'Authorization': 'Bearer room', 'Accept': 'application/json'}
          });
          if (reply.status === 404) return;
          if (!reply.ok) {
            scheduleTurnRefresh(30000);
            return;
          }
          const value = await reply.json();
          if (!Array.isArray(value.iceServers) || !value.iceServers.length) {
            throw new Error('empty ICE config');
          }
          iceServers = value.iceServers;
          iceExpiresAt = Number(value.expires_at) * 1000 || Date.now() + 300000;
          applyIceServersToPeers();
          scheduleTurnRefresh(iceExpiresAt - Date.now() - 60000);
        } catch (_) {
          scheduleTurnRefresh(30000);
        }
      })().finally(() => { iceRefreshPromise = null; });
      return iceRefreshPromise;
    }

    async function preflightRoom() {
      if (terminalRoom) return false;
      try {
        const reply = await window.fetch('https://room.test/api/room', {
          headers: {'Authorization': 'Bearer room', 'Accept': 'application/json'}
        });
        if (reply.status === 401 || reply.status === 410) {
          terminalRoom = true;
          return false;
        }
        return true;
      } catch (_) {
        return true;
      }
    }

    async function connect() {
      if (leaving) return;
      if (!await preflightRoom()) return;
      await refreshIceServers();
      ws = new window.WebSocket('wss://room.test/ws/example');
    }

    function disconnectRoom() {
      if (leaving) return;
      leaving = true;
      ws = null;
    }
    function suspendRoom() {
      if (explicitLeave) return;
      disconnectRoom();
    }
    function restoreSuspendedRoom(event) {
      if (!event.persisted || explicitLeave) return;
      leaving = false;
      roomFull = false;
      if (!roleChosen || terminalRoom) return;
      restoreConnectPromise = connect();
    }
    window.addEventListener('pagehide', suspendRoom);
    window.addEventListener('pageshow', restoreSuspendedRoom);

    function stateForTest() {
      return {
        leaving,
        terminalRoom,
        iceServers: iceServers.map(item => ({...item})),
        appliedIce: [...appliedIce],
        turnSchedules: [...turnSchedules],
        ws,
      };
    }
    function connectForTest() { return connect(); }
    function refreshForTest() { return refreshIceServers(true); }
    function restorePromiseForTest() { return restoreConnectPromise; }
  `, context, {filename: "room-connect-globals.js"});

  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    context,
    windowTarget,
    fetchCalls,
    timers,
    state: () => context.stateForTest(),
    connect: () => context.connectForTest(),
    refresh: () => context.refreshForTest(),
    restorePromise: () => context.restorePromiseForTest(),
  };
}

function turnBody(url) {
  return {iceServers: [{urls: url}], expires_at: Math.floor(Date.now() / 1000) + 300};
}

test("current-generation preflight and TURN body install before signalling", async () => {
  const h = harness();
  const connect = h.connect();
  await waitFor(() => h.fetchCalls.length === 1, "preflight");
  h.fetchCalls[0].respond(response(200));
  await waitFor(() => h.fetchCalls.length === 2, "TURN request");

  const body = deferred();
  h.fetchCalls[1].respond(response(200, body));
  body.resolve(turnBody("turn:fresh"));
  await connect;

  assert.equal(MockWebSocket.created.length, 1);
  assert.equal(h.state().iceServers[0].urls, "turn:fresh");
  assert.deepEqual(Array.from(h.state().appliedIce), ["turn:fresh"]);
});

test("BFCache restore rejects an old TURN body and performs a fresh-generation TURN request", async () => {
  const h = harness();
  const oldConnect = h.connect();
  await waitFor(() => h.fetchCalls.length === 1, "old preflight");
  h.fetchCalls[0].respond(response(200));
  await waitFor(() => h.fetchCalls.length === 2, "old TURN request");

  const oldBody = deferred();
  h.fetchCalls[1].respond(response(200, oldBody));
  await waitFor(() => h.fetchCalls[1].init.signal?.aborted === false, "old TURN body ownership");

  h.windowTarget.dispatch("pagehide", {persisted: true});
  assert.equal(h.fetchCalls[1].init.signal.aborted, true,
    "pagehide retains lifecycle ownership after TURN headers until JSON settles");
  h.windowTarget.dispatch("pageshow", {persisted: true});

  await waitFor(() => h.fetchCalls.length === 3,
    "restored room preflight before the old TURN task retires");
  h.fetchCalls[2].respond(response(200));
  await Promise.resolve();
  assert.equal(h.fetchCalls.length, 3,
    "fresh generation waits for old TURN task instead of coalescing onto it");

  oldBody.resolve(turnBody("turn:stale"));
  await oldConnect;
  await waitFor(() => h.fetchCalls.length === 4, "fresh TURN request");
  assert.deepEqual(Array.from(h.state().appliedIce), [],
    "stale body never reaches the room ICE globals or peers");

  const freshBody = deferred();
  h.fetchCalls[3].respond(response(200, freshBody));
  freshBody.resolve(turnBody("turn:fresh"));
  await waitFor(() => MockWebSocket.created.length === 1, "restored signalling");
  await h.restorePromise();

  const state = h.state();
  assert.equal(MockWebSocket.created.length, 1,
    "only the restored generation creates a real socket");
  assert.equal(state.iceServers[0].urls, "turn:fresh");
  assert.deepEqual(Array.from(state.appliedIce), ["turn:fresh"]);
});

test("capture-phase BFCache restore state is live before the room restore handler calls connect", async () => {
  const h = harness();
  h.windowTarget.dispatch("pagehide", {persisted: true});
  h.windowTarget.dispatch("pageshow", {persisted: true});

  await waitFor(() => h.fetchCalls.length === 1, "restored preflight");
  assert.match(h.fetchCalls[0].input, /\/api\/room$/);
  h.fetchCalls[0].respond(response(200));
  await waitFor(() => h.fetchCalls.length === 2, "restored TURN");
  const body = deferred();
  h.fetchCalls[1].respond(response(200, body));
  body.resolve(turnBody("turn:restored"));
  await h.restorePromise();

  assert.equal(MockWebSocket.created.length, 1,
    "room's first pageshow connect is not lost behind the deferred shim's suspended flag");
});

test("stale pending preflight cannot advance to TURN or signalling after restore", async () => {
  const h = harness();
  const oldConnect = h.connect();
  await waitFor(() => h.fetchCalls.length === 1, "old preflight");

  h.windowTarget.dispatch("pagehide", {persisted: true});
  assert.equal(h.fetchCalls[0].init.signal.aborted, true);
  h.windowTarget.dispatch("pageshow", {persisted: true});
  await oldConnect;
  await waitFor(() => h.fetchCalls.length === 2, "fresh preflight");
  assert.match(h.fetchCalls[1].input, /\/api\/room$/,
    "the stale preflight does not continue into TURN");

  h.fetchCalls[1].respond(response(200));
  await waitFor(() => h.fetchCalls.length === 3, "fresh TURN");
  const body = deferred();
  h.fetchCalls[2].respond(response(200, body));
  body.resolve(turnBody("turn:fresh"));
  await h.restorePromise();
  assert.equal(MockWebSocket.created.length, 1);
});

test("same-generation TURN refresh calls still coalesce", async () => {
  const h = harness();
  const first = h.refresh();
  const second = h.refresh();
  assert.equal(first, second);
  await waitFor(() => h.fetchCalls.length === 1, "TURN request");

  const body = deferred();
  h.fetchCalls[0].respond(response(200, body));
  body.resolve(turnBody("turn:coalesced"));
  await Promise.all([first, second]);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.state().iceServers[0].urls, "turn:coalesced");
});

test("current terminal preflight still stops connect without turning terminal state into lifecycle cancellation", async () => {
  const h = harness();
  const connect = h.connect();
  await waitFor(() => h.fetchCalls.length === 1, "terminal preflight");
  h.fetchCalls[0].respond(response(410));
  await assert.doesNotReject(connect);
  assert.equal(h.state().terminalRoom, true);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(MockWebSocket.created.length, 0);
});

test("source pins connect generation, JSON-body lifecycle ownership, and capture-phase restore ordering", () => {
  assert.match(source, /ROOM_CONTROL_JSON_PATHS = new Set\(\["\/api\/capabilities", "\/api\/turn"\]\)/);
  assert.match(source, /let browserTurnRefreshGeneration = -1/);
  assert.match(source, /function browserRoomGenerationActive\(generation\)/);
  assert.match(source, /preflightRoom = async function lifecycleAwarePreflightRoom/);
  assert.match(source, /refreshIceServers = function lifecycleAwareRefreshIceServers/);
  assert.match(source, /previousTask && previousGeneration !== generation/);
  assert.match(source, /await previousTask/);
  assert.match(source, /connect = async function lifecycleAwareConnect/);
  assert.match(source, /new Proxy\(response/);
  assert.match(source, /const value = await readJson\(\.\.\.args\)/);
  assert.match(source, /browserRoomGenerationActive\(requestGeneration\)/);
  assert.match(source, /window\.addEventListener\("pagehide"[\s\S]*?\{capture: true\}\)/);
  assert.match(source, /window\.addEventListener\("pageshow"[\s\S]*?\{capture: true\}\)/);
});

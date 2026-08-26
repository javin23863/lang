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
    this.hidden = false;
    this.onclick = null;
    this.attributes = new Map();
    this.classList = {
      values: new Set(),
      add: value => this.classList.values.add(value),
      remove: value => this.classList.values.delete(value),
      contains: value => this.classList.values.has(value),
    };
  }
  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({listener, capture: options === true || options?.capture === true, once: options?.once === true});
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(entry => entry.listener !== listener));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  dispatch(type, event = {}) {
    if (type === "click" && this.disabled) return;
    let stopped = false;
    const wrapped = {
      type,
      ...event,
      preventDefault() { event.preventDefault?.(); },
      stopImmediatePropagation() { stopped = true; event.stopImmediatePropagation?.(); },
    };
    const listeners = [...(this.listeners.get(type) || [])];
    for (const entry of listeners) {
      entry.listener.call(this, wrapped);
      if (entry.once) this.removeEventListener(type, entry.listener);
      if (stopped) return;
    }
    if (type === "click" && typeof this.onclick === "function") return this.onclick.call(this, wrapped);
  }
}

class MockWebSocket extends MockTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor() {
    super();
    this.readyState = MockWebSocket.OPEN;
  }
  close() { this.readyState = MockWebSocket.CLOSED; }
  send() {}
}

class MockRTCPeerConnection {}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}

function harness({popupOpens = true, clipboardDeferred = null} = {}) {
  const windowTarget = new MockTarget();
  const ids = ["shareBtn", "waBtn", "lineBtn", "qrBtn", "qrBox", "leaveBtn", "reportBtn"];
  const elements = new Map(ids.map(id => [id, new MockTarget()]));
  const qrScript = new MockTarget();
  const document = new MockTarget();
  document.visibilityState = "visible";
  document.getElementById = id => elements.get(id) || null;
  document.createElement = () => qrScript;
  document.head = {appendChild() {}};

  const shareTask = deferred();
  const statusKeys = [];
  const openCalls = [];
  const clipboardCalls = [];
  const disconnectCalls = [];

  windowTarget.fetch = async () => ({ok: true, status: 204});
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.RTCPeerConnection = MockRTCPeerConnection;
  windowTarget.LinguaNative = undefined;
  windowTarget.setTimeout = setTimeout;
  windowTarget.clearTimeout = clearTimeout;
  windowTarget.open = (...args) => {
    openCalls.push(args);
    return popupOpens ? {opener: {}} : null;
  };

  const navigator = {
    mediaDevices: null,
    clipboard: {
      writeText(value) {
        clipboardCalls.push(value);
        return clipboardDeferred ? clipboardDeferred.promise : Promise.resolve();
      },
    },
  };
  const runtime = {
    share() { return shareTask.promise; },
  };

  const context = vm.createContext({
    window: windowTarget,
    document,
    navigator,
    runtime,
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
    encodeURIComponent,
    console,
    roomMode: "video",
    SHARE_TEXT: {voice: "share.textVoice", chat: "share.textChat", video: "share.textVideo"},
    t(key) { return key; },
    inviteLink() { return "https://room.test/room/example?mode=video"; },
    setStatus(key) { statusKeys.push(key); },
    leaving: false,
    explicitLeave: false,
    terminalRoom: false,
    disconnectRoom(...args) { disconnectCalls.push(args); },
    async handle(message) {
      if (message?.type === "host_closed") context.terminalRoom = true;
    },
  });
  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    windowTarget,
    qrScript,
    shareTask,
    statusKeys,
    openCalls,
    clipboardCalls,
    disconnectCalls,
    element: id => elements.get(id),
    disconnect: (...args) => context.disconnectRoom(...args),
    handle: message => context.handle(message),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("current-generation share keeps the existing WhatsApp fallback", async () => {
  const h = harness();
  h.element("shareBtn").dispatch("click");
  h.shareTask.resolve(false);
  await settle();

  assert.equal(h.openCalls.length, 1);
  assert.match(h.openCalls[0][0], /^https:\/\/wa\.me\/\?text=/);
});

test("pending share cannot open an invitation after explicit Leave", async () => {
  const h = harness();
  h.element("shareBtn").dispatch("click");
  h.element("leaveBtn").dispatch("click");
  h.shareTask.resolve(false);
  await settle();

  assert.equal(h.openCalls.length, 0, "old share continuation must not open WhatsApp after Leave");
  assert.deepEqual(h.statusKeys, [], "old share completion must not repaint terminal room status");
  for (const id of ["shareBtn", "waBtn", "lineBtn", "qrBtn"]) {
    assert.equal(h.element(id).disabled, true, `${id} is retired after permanent teardown`);
  }
});

test("BFCache-old share cannot act after a restored room generation", async () => {
  const h = harness();
  h.element("shareBtn").dispatch("click");
  h.windowTarget.dispatch("pagehide", {type: "pagehide"});
  h.disconnect(false);
  h.windowTarget.dispatch("pageshow", {type: "pageshow", persisted: true});
  h.shareTask.resolve(false);
  await settle();

  assert.equal(h.openCalls.length, 0);
  assert.deepEqual(h.statusKeys, []);
  assert.equal(h.element("shareBtn").disabled, false,
    "temporary BFCache suspension must not permanently retire invitations");
});

test("clipboard completion after teardown cannot repaint share status", async () => {
  const clipboardTask = deferred();
  const h = harness({popupOpens: false, clipboardDeferred: clipboardTask});
  h.element("shareBtn").dispatch("click");
  h.shareTask.resolve(false);
  await settle();
  assert.equal(h.clipboardCalls.length, 1, "live fallback reaches clipboard when popup is blocked");

  h.element("leaveBtn").dispatch("click");
  clipboardTask.resolve();
  await settle();

  assert.deepEqual(h.statusKeys, [], "late clipboard completion must not report link copied after Leave");
});

test("late QR encoder load cannot re-enable invitations after teardown", () => {
  const h = harness();
  h.element("leaveBtn").dispatch("click");
  assert.equal(h.element("qrBtn").disabled, true);
  h.qrScript.dispatch("load", {type: "load"});
  assert.equal(h.element("qrBtn").disabled, true);
});

test("host terminal closure retires direct invitation controls", async () => {
  const h = harness();
  await h.handle({type: "host_closed"});
  for (const id of ["shareBtn", "waBtn", "lineBtn", "qrBtn"]) {
    assert.equal(h.element(id).disabled, true, `${id} is retired after host closure`);
  }
});

test("source pins generation-aware sharing and invitation retirement", () => {
  assert.match(source, /function retireInvitationControls\(\)/);
  assert.match(source, /const shareButton = document\.getElementById\("shareBtn"\)/);
  assert.match(source, /shareButton\.onclick = async \(\) =>/);
  assert.match(source, /const generation = browserRoomGeneration/);
  assert.match(source, /await runtime\.share\(invite\)[\s\S]*?generation !== browserRoomGeneration/);
  assert.match(source, /await navigator\.clipboard\.writeText\(invite\.url\)[\s\S]*?generation !== browserRoomGeneration/);
  assert.match(source, /event\.stopImmediatePropagation\?\.\(\)/);
  assert.match(source, /if \(qrButton && !browserMediaLifecycleEnded\) qrButton\.disabled = false/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../www/room-blocking.js", import.meta.url), "utf8");
const roomHtml = await readFile(new URL("../www/room.html", import.meta.url), "utf8");
const BLOCK_B = "B".repeat(22);
const ROOM_TOKEN = `${"R".repeat(24)}.1999999999.${"S".repeat(43)}`;

class Storage {
  constructor(seed = {}) { this.values = new Map(Object.entries(seed)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.type = "";
    this.textContent = "";
    this.disabled = false;
    this.style = {};
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute() {}
  click() { this.listeners.get("click")?.(); }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.elements = new Map([
      ["reportBtn", new FakeElement("reportBtn")],
      ["roomMenu", new FakeElement("roomMenu")],
    ]);
    this.elements.get("roomMenu").insertBefore = element => this.elements.set(element.id, element);
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  getElementById(id) { return this.elements.get(id) || null; }
  createElement() { return new FakeElement(); }
  ready() { this.listeners.get("DOMContentLoaded")?.(); }
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = String(url);
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    this.listeners = new Map();
    this.onmessage = null;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  send(data) { this.sent.push(data); }
  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    const event = {code, reason};
    for (const listener of this.listeners.get("close") || []) listener(event);
  }
  emit(message) {
    const event = {
      data: JSON.stringify(message),
      stopped: false,
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const listener of this.listeners.get("message") || []) {
      listener(event);
      if (event.stopped) break;
    }
    if (!event.stopped) this.onmessage?.(event);
    return event;
  }
}

function harness(seed = {}) {
  const localStorage = new Storage(seed);
  const document = new FakeDocument();
  const state = {leaves: 0, statuses: []};
  const context = {
    URL,
    Request,
    Response,
    Uint8Array,
    btoa,
    confirm: () => true,
    crypto: globalThis.crypto,
    document,
    fetch: async () => new Response("{}", {status: 201}),
    localStorage,
    location: {href: `https://room.test/room/${ROOM_TOKEN}`},
    WebSocket: FakeWebSocket,
    LinguaRuntime: {roomToken: () => ROOM_TOKEN},
    leaveRoom: () => { state.leaves += 1; },
    setStatus: (...args) => state.statuses.push(args),
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, {filename: "room-blocking.js"});
  return {context, document, localStorage, state};
}

test("native room package loads the participant-blocking layer", () => {
  assert.match(roomHtml, /<script src="\/room-blocking\.js"><\/script>/);
});

test("join frames carry one stable random safety id and a bounded local block list", () => {
  const storage = new Storage();
  const first = harness();
  first.context.localStorage = storage;

  // Reload with one shared installation store so the identity contract is
  // tested across page instances rather than only across sockets.
  const page1 = harness();
  page1.context.localStorage = storage;
  vm.runInContext(source, page1.context, {filename: "room-blocking-reload.js"});
  const ws1 = new page1.context.WebSocket("wss://room.test/ws/v1/token");
  ws1.send(JSON.stringify({type: "join", locale: "en-US"}));
  const join1 = JSON.parse(ws1.sent[0]);
  assert.match(join1.block_id, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(join1.blocked_ids, []);

  page1.context.LinguaRoomBlocking.block(BLOCK_B);
  const ws2 = new page1.context.WebSocket("wss://room.test/ws/v1/token2");
  ws2.send(JSON.stringify({type: "join", locale: "en-US"}));
  const join2 = JSON.parse(ws2.sent[0]);
  assert.equal(join2.block_id, join1.block_id);
  assert.deepEqual(join2.blocked_ids, [BLOCK_B]);

  for (let index = 0; index < 140; index++) {
    page1.context.LinguaRoomBlocking.block(`${String(index).padStart(22, "A")}`);
  }
  assert.equal(page1.context.LinguaRoomBlocking.blockedIds().length, 128);
});

test("a previously blocked peer is stopped before the room handler receives presence", () => {
  const h = harness({
    "lingua-relay.blocked-participants.v1": JSON.stringify([BLOCK_B]),
  });
  const ws = new h.context.WebSocket("wss://room.test/ws/v1/token");
  let appMessages = 0;
  ws.onmessage = () => { appMessages += 1; };

  const event = ws.emit({
    type: "welcome",
    id: "self",
    peers: [{id: "peer", block_id: BLOCK_B}],
  });
  assert.equal(event.stopped, true);
  assert.equal(appMessages, 0, "blocked presence cannot reach WebRTC room handling");
  assert.equal(h.state.leaves, 1);
  assert.equal(
    h.localStorage.getItem(`lingua-relay.blocked-room.${ROOM_TOKEN}`),
    "1",
  );
});

test("reporting and the independent block control both persist the current peer", async () => {
  const reportHarness = harness();
  const reportSocket = new reportHarness.context.WebSocket("wss://room.test/ws/v1/token");
  reportSocket.emit({type: "peer_join", id: "peer", block_id: BLOCK_B});
  assert.equal(reportHarness.context.LinguaRoomBlocking.isBlocked(BLOCK_B), false);
  await reportHarness.context.fetch("https://room.test/api/reports", {method: "POST"});
  assert.equal(reportHarness.context.LinguaRoomBlocking.isBlocked(BLOCK_B), true);

  const buttonHarness = harness();
  buttonHarness.document.ready();
  const buttonSocket = new buttonHarness.context.WebSocket("wss://room.test/ws/v1/token");
  buttonSocket.emit({type: "peer_join", id: "peer", block_id: BLOCK_B});
  const button = buttonHarness.document.getElementById("blockParticipantBtn");
  assert.ok(button, "room menu must expose an independent Block participant action");
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(buttonHarness.context.LinguaRoomBlocking.isBlocked(BLOCK_B), true);
  assert.equal(buttonHarness.state.leaves, 1);
});

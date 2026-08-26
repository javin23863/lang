import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../../windows/static/app-runtime.js", import.meta.url),
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
}

class MockWebSocket extends MockTarget {
  static OPEN = 1;
  constructor() { super(); this.readyState = 0; }
}

class MockPeerConnection extends MockTarget {
  constructor() { super(); this.iceConnectionState = "new"; }
  restartIce() {}
}

function harness() {
  const timeoutCallbacks = [];
  const fetchCalls = [];
  const nativeFetch = (input, init = {}) => new Promise((resolve, reject) => {
    const call = {input, init, resolve, reject};
    fetchCalls.push(call);
    if (init.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    init.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, {once: true});
  });

  const window = {
    LinguaNative: undefined,
    WebSocket: MockWebSocket,
    RTCPeerConnection: MockPeerConnection,
    fetch: nativeFetch,
  };
  const document = {
    readyState: "loading",
    documentElement: {lang: "", dir: ""},
    addEventListener() {},
    querySelectorAll() { return []; },
  };
  const localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
  const navigator = {languages: ["en-US"], language: "en-US"};
  const context = vm.createContext({
    window,
    document,
    localStorage,
    navigator,
    location: {
      origin: "https://room.test",
      href: "https://room.test/room/example",
      pathname: "/room/example",
      search: "",
    },
    URL,
    URLSearchParams,
    Request,
    AbortController,
    DOMException,
    setTimeout(callback, delay) {
      timeoutCallbacks.push({callback, delay});
      return timeoutCallbacks.length;
    },
    clearTimeout() {},
  });
  vm.runInContext(source, context, {filename: "app-runtime.js"});
  return {window, timeoutCallbacks, fetchCalls};
}

test("the first browser capability probe is bounded before deferred room bootstrap runs", async () => {
  const {window, timeoutCallbacks, fetchCalls} = harness();

  const pending = window.fetch("https://room.test/api/capabilities", {
    cache: "no-store",
    headers: {Accept: "application/json"},
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(timeoutCallbacks.length, 1);
  assert.equal(timeoutCallbacks[0].delay, 12000);
  assert.notEqual(fetchCalls[0].init.signal, undefined);
  assert.equal(fetchCalls[0].init.signal.aborted, false);

  timeoutCallbacks[0].callback();
  await assert.rejects(pending, error => error?.name === "AbortError");
  assert.equal(fetchCalls[0].init.signal.aborted, true);
});

test("the initial capability deadline preserves caller cancellation", async () => {
  const {window, fetchCalls} = harness();
  const caller = new AbortController();
  const pending = window.fetch("https://room.test/api/capabilities", {signal: caller.signal});

  assert.equal(fetchCalls.length, 1);
  assert.notEqual(fetchCalls[0].init.signal, caller.signal,
    "the bootstrap owns its deadline controller rather than mutating the caller");
  caller.abort();
  await assert.rejects(pending, error => error?.name === "AbortError");
  assert.equal(fetchCalls[0].init.signal.aborted, true);
});

test("only the first same-origin capability bootstrap consumes the early deadline", () => {
  const {window, timeoutCallbacks, fetchCalls} = harness();

  void window.fetch("https://other.test/api/capabilities");
  assert.equal(timeoutCallbacks.length, 0, "cross-origin traffic is never given the room deadline");

  void window.fetch("https://room.test/api/capabilities");
  assert.equal(timeoutCallbacks.length, 1, "the real bootstrap remains eligible after unrelated traffic");

  void window.fetch("https://room.test/api/capabilities");
  assert.equal(timeoutCallbacks.length, 1,
    "later capability work is left to the accepted deferred room-control wrapper");
  assert.equal(fetchCalls.length, 3);
});

test("source keeps the early deadline browser-room-only and ahead of the TURN response policy", () => {
  assert.match(source, /const BROWSER_BOOTSTRAP_FETCH_TIMEOUT_MS = 12000/);
  assert.match(source, /let bootstrapCapabilitiesPending = true/);
  assert.match(source,
    /bootstrapCapabilitiesPending[\s\S]*url\.origin === location\.origin[\s\S]*url\.pathname === "\/api\/capabilities"/);
  assert.match(source, /bootstrapCapabilitiesPending = false/);
  assert.match(source, /const callerSignal = init\.signal/);
  assert.match(source, /input instanceof Request \? input\.signal : null/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), BROWSER_BOOTSTRAP_FETCH_TIMEOUT_MS\)/);
  assert.match(source, /nativeFetch\(input, \{\.\.\.init, signal: controller\.signal\}\)/);
  assert.match(source, /clearTimeout\(timer\)/);
  assert.match(source, /callerSignal\?\.removeEventListener\("abort", abortFromCaller\)/);
  assert.ok(
    source.indexOf('url.pathname === "/api/capabilities"') < source.indexOf('url.pathname !== "/api/turn"'),
    "capability timeout is applied before the existing TURN response policy",
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../www/dashboard-api.js", import.meta.url), "utf8");

function loadApi({fetchImpl, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout}) {
  const context = {
    window: {},
    AbortController,
    fetch: fetchImpl,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
  };
  vm.runInNewContext(source, context, {filename: "dashboard-api.js"});
  return context.window.LinguaDashboardApi;
}

test("dashboard API preserves caller cancellation while enforcing its own deadline", async () => {
  let requestSignal = null;
  const api = loadApi({
    fetchImpl: (_input, init) => {
      requestSignal = init.signal;
      return new Promise((_, reject) => {
        if (requestSignal.aborted) return reject(new Error("aborted"));
        requestSignal.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
      });
    },
  });
  assert.equal(api.timeoutMs, 15_000);

  const caller = new AbortController();
  const pending = api.fetch("https://room.test/api/rooms", {signal: caller.signal});
  caller.abort("caller-cancelled");
  await assert.rejects(pending, /aborted/);
  assert.equal(requestSignal.aborted, true);
});

test("dashboard API clears its deadline timer after a settled request", async () => {
  const timer = {id: "deadline"};
  let cleared = null;
  const response = {ok: true};
  const api = loadApi({
    fetchImpl: async () => response,
    setTimeoutImpl: () => timer,
    clearTimeoutImpl: value => { cleared = value; },
  });

  assert.equal(await api.fetch("https://room.test/health"), response);
  assert.equal(cleared, timer);
});

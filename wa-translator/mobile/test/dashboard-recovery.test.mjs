import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../www/", import.meta.url);
const accountSource = await readFile(new URL("dashboard-account.js", root), "utf8");
const lifecycleSource = await readFile(new URL("dashboard-lifecycle.js", root), "utf8");

function loadAccount(fetchImpl) {
  const context = {window: {}, document: {}};
  vm.runInNewContext(accountSource, context, {filename: "dashboard-account.js"});
  return context.window.LinguaDashboardAccount.create({
    runtime: {apiUrl: path => `https://room.test${path}`},
    fetch: fetchImpl,
    t: key => key,
    byId: () => ({replaceChildren() {}}),
  });
}

test("account snapshot distinguishes an outage from a real signed-out response", async () => {
  let calls = 0;
  const presenter = loadAccount(async () => {
    calls++;
    if (calls === 1) throw new Error("offline");
    return Response.json({signed_in: false, providers: ["google"]});
  });

  const unavailable = await presenter.load();
  assert.deepEqual(JSON.parse(JSON.stringify(unavailable)), {
    signed_in: false,
    providers: [],
    unavailable: true,
  });

  const recovered = await presenter.load();
  assert.equal(recovered.signed_in, false);
  assert.deepEqual(recovered.providers, ["google"]);
  assert.equal(Object.hasOwn(recovered, "unavailable"), false);
});

test("dashboard lifecycle retries recovery only when the app is usable", async () => {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    visibilityState: "hidden",
    addEventListener: (name, listener) => documentListeners.set(name, listener),
  };
  const window = {
    addEventListener: (name, listener) => windowListeners.set(name, listener),
  };
  const context = {window, document};
  vm.runInNewContext(lifecycleSource, context, {filename: "dashboard-lifecycle.js"});

  let recoveries = 0;
  let readyCalls = 0;
  const lifecycle = window.LinguaDashboardLifecycle.create({
    runtime: {isNative: true, ready: async () => { readyCalls++; }},
    onVisible: () => { recoveries++; },
  });
  lifecycle.install();

  assert.ok(documentListeners.has("visibilitychange"));
  assert.ok(windowListeners.has("online"));
  windowListeners.get("online")();
  assert.equal(recoveries, 0, "background connectivity changes do not start work");

  document.visibilityState = "visible";
  windowListeners.get("online")();
  assert.equal(recoveries, 1, "online recovery runs when visible");
  documentListeners.get("visibilitychange")();
  assert.equal(recoveries, 2, "foreground recovery uses the same path");

  await lifecycle.ready();
  assert.equal(readyCalls, 1);
});

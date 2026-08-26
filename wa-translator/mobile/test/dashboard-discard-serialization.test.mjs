import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../www/dashboard-room-controller.js", import.meta.url), "utf8");

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return {promise, resolve};
}

function loadController() {
  const context = {
    window: {},
    document: {visibilityState: "visible"},
    setInterval: () => 1,
    clearInterval: () => {},
  };
  vm.runInNewContext(source, context, {filename: "dashboard-room-controller.js"});
  return context.window.LinguaDashboardRoomController;
}

test("discard serializes persistent retirement against foreground restore", async () => {
  const pendingForget = deferred();
  let loads = 0;
  const model = {
    normalizeMode: value => value,
    valid: () => true,
    save: async () => true,
    load: async () => { loads++; return null; },
    forget: async () => pendingForget.promise,
    mode: () => "video",
  };
  const controller = loadController().create({
    runtime: {apiUrl: path => path, openRoom: () => true},
    fetch: async () => { throw new Error("network should not be used"); },
    model,
    events: () => null,
    confirmAction: () => true,
    onBusy: () => {},
    onNotice: () => {},
    onRender: () => {},
    onClear: () => {},
  });

  const retirement = controller.discard();
  assert.equal(controller.isBusy(), true,
    "discard must hold the same controller lock used by restore and room actions");
  assert.equal(await controller.restore(), null);
  assert.equal(loads, 0,
    "foreground recovery cannot read the slot while its tombstone write is in flight");

  pendingForget.resolve(true);
  assert.equal(await retirement, true);
  assert.equal(controller.isBusy(), false);

  assert.equal(await controller.restore(), null);
  assert.equal(loads, 1,
    "restore can run again only after persistent retirement has completed");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared native room carries privacy-safe activation events", async () => {
  const [html, events, adapter] = await Promise.all([
    readFile(new URL("room.html", root), "utf8"),
    readFile(new URL("product-events.js", root), "utf8"),
    readFile(new URL("room-product-events.js", root), "utf8"),
  ]);

  const runtime = html.indexOf('<script src="/app-runtime.js"></script>');
  const productEvents = html.indexOf('<script src="/product-events.js"></script>');
  const roomEvents = html.indexOf('<script src="/room-product-events.js"></script>');
  const roomRuntime = html.indexOf('<script src="/room.js"></script>');
  assert.ok(runtime >= 0 && productEvents > runtime && roomEvents > productEvents && roomRuntime > roomEvents,
    "activation events load after runtime and before room behavior");

  for (const marker of [
    '"room.join.intent": new Set(["mode"])',
    '"room.pair.ready": new Set(["mode"])',
    '"translation.first.result": new Set(["mode"])',
    '"network.state": new Set(["state"])',
  ]) assert.ok(events.includes(marker), `event allowlist contains ${marker}`);

  for (const marker of [
    'emit("room.join.intent", {mode})',
    'emit("room.pair.ready", {mode})',
    'emit("translation.first.result", {mode})',
    'emit("network.state", {state: "offline"})',
    'emit("network.state", {state: "online"})',
    'new MutationObserver(check).observe(count',
    'captions.querySelectorAll(".msg .sub")',
  ]) assert.ok(adapter.includes(marker), `room activation adapter contains ${marker}`);

  for (const forbidden of [
    "fetch(", "sendBeacon", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage",
    "document.cookie", "Authorization", "roomId", "host_control", "shareLink", "transcript",
  ]) assert.ok(!adapter.includes(forbidden), `room activation adapter excludes ${forbidden}`);
});

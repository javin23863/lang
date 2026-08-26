import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared mobile bundle carries the privacy-safe product event seam", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const source = await readFile(new URL("product-events.js", root), "utf8");
  const dashboard = await readFile(new URL("dashboard-product-events.js", root), "utf8");

  assert.match(html, /<script src="\/product-events\.js" defer><\/script>/);
  assert.match(html, /<script src="\/dashboard-product-events\.js" defer><\/script>/);
  assert.match(source, /new CustomEvent\("lingua:product-event"/);
  assert.match(source, /"app\.open"/);
  assert.match(source, /"room\.create\.result"/);
  assert.match(source, /FORBIDDEN_FIELD/);

  for (const marker of [
    'events.emit("room.create.intent", {mode})',
    'events.emit("invite.share.intent", {method})',
    'events.emit("room.open.intent")',
    'events.emit("locale.change", {locale: target.value})',
    'events.emit("auth.state", {state, provider_count: providerCount})',
  ]) assert.ok(dashboard.includes(marker), `dashboard telemetry is missing ${marker}`);

  for (const candidate of [source, dashboard]) {
    for (const forbidden of [
      "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "localStorage",
      "sessionStorage", "document.cookie",
    ]) assert.ok(!candidate.includes(forbidden), `telemetry seam must not contain ${forbidden}`);
  }
  for (const forbidden of ["shareLink.value", "roomId", "host_control", "accountName"]) {
    assert.ok(!dashboard.includes(forbidden), `dashboard telemetry must not inspect ${forbidden}`);
  }
});

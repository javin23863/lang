import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared mobile bundle carries the privacy-safe product event seam", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const source = await readFile(new URL("product-events.js", root), "utf8");

  assert.match(html, /<script src="\/product-events\.js" defer><\/script>/);
  assert.match(source, /new CustomEvent\("lingua:product-event"/);
  assert.match(source, /"app\.open"/);
  assert.match(source, /"room\.create\.result"/);
  assert.match(source, /FORBIDDEN_FIELD/);

  for (const forbidden of [
    "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "localStorage",
    "sessionStorage", "document.cookie",
  ]) assert.ok(!source.includes(forbidden), `telemetry seam must not contain ${forbidden}`);
});

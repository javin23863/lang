import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MOBILE_BUILD, MOBILE_PROTOCOL, PUBLIC_ORIGIN, apiPath, createSecureHostStorage, parseRoomLink,
  roomPageUrl, validateBootstrap, websocketPath,
} from "../src/runtime-core.mjs";

const TOKEN = "Abcdefghijklmnopqrstuvwx.1786750205.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

test("deep links accept only exact signed public room URLs", () => {
  assert.equal(
    parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}`), TOKEN
  );
  assert.equal(parseRoomLink(`https://attacker.test/room/${TOKEN}`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}.attacker.test/room/${TOKEN}`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?copy=1`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/rooms/${TOKEN}`), null);
  assert.equal(parseRoomLink("not a url"), null);
});

test("native traffic stays on the versioned backend seam", () => {
  assert.equal(apiPath("/api/capabilities", true), "/api/v1/capabilities");
  assert.equal(apiPath("/api/reports", true), "/api/v1/reports");
  assert.equal(apiPath("/tts", true), "/api/v1/tts");
  assert.equal(apiPath("/api/capabilities", false), "/api/capabilities");
  assert.throws(() => apiPath("/api/not-a-real-route", true), /Unsupported native API path/);
  assert.equal(websocketPath(TOKEN, true), `/ws/v1/${TOKEN}`);
  assert.equal(websocketPath(TOKEN, false), `/ws/${TOKEN}`);
  assert.equal(roomPageUrl(TOKEN), `room.html?room=${encodeURIComponent(TOKEN)}`);
});

test("installed clients fail closed on incompatible backend bootstrap", () => {
  const valid = {
    protocol: MOBILE_PROTOCOL, minimum_client_build: MOBILE_BUILD,
    public_origin: PUBLIC_ORIGIN, account_mode: "none", call_lifecycle: "foreground",
  };
  assert.equal(validateBootstrap(valid, MOBILE_BUILD), true);
  assert.equal(validateBootstrap({...valid, protocol: 2}, MOBILE_BUILD), false);
  assert.equal(validateBootstrap({...valid, minimum_client_build: MOBILE_BUILD + 1}, MOBILE_BUILD), false);
  assert.equal(validateBootstrap({...valid, public_origin: "https://attacker.test"}, MOBILE_BUILD), false);
});

test("host room control state round-trips only through the secure adapter", async () => {
  const values = new Map();
  const calls = [];
  const storage = createSecureHostStorage({
    async get(key) { calls.push(["get", key]); return values.get(key); },
    async set(key, value) { calls.push(["set", key, value]); values.set(key, value); },
    async remove(key) { calls.push(["remove", key]); values.delete(key); },
  });
  await storage.setItem("host-room", "hc1.secret");
  assert.equal(await storage.getItem("host-room"), "hc1.secret");
  await storage.removeItem("host-room");
  assert.equal(await storage.getItem("host-room"), null);
  assert.deepEqual(calls, [
    ["set", "host-room", "hc1.secret"], ["get", "host-room"],
    ["remove", "host-room"], ["get", "host-room"],
  ]);
});

test("Capacitor boots bundled files and uses the fixed product identifier", async () => {
  const config = await readFile(new URL("../capacitor.config.ts", import.meta.url), "utf8");
  assert.match(config, /appId:\s*["']com\.javin23863\.linguarelay["']/);
  assert.match(config, /webDir:\s*["']www["']/);
  assert.doesNotMatch(config, /server\s*:\s*\{[^}]*url\s*:/s);

  const packageJson = JSON.parse(await readFile(
    new URL("../package.json", import.meta.url), "utf8"
  ));
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.engines.node, ">=22");
  assert.ok(packageJson.dependencies["@capacitor/core"]);
  assert.ok(packageJson.dependencies["@aparajita/capacitor-secure-storage"]);
});

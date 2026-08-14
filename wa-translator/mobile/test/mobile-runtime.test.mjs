import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MOBILE_BUILD, MOBILE_PROTOCOL, PUBLIC_ORIGIN, apiPath, parseRoomLink,
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
  assert.equal(apiPath("/tts", true), "/api/v1/tts");
  assert.equal(apiPath("/api/capabilities", false), "/api/capabilities");
  assert.equal(websocketPath(TOKEN, true), `/ws/v1/${TOKEN}`);
  assert.equal(websocketPath(TOKEN, false), `/ws/${TOKEN}`);
  assert.equal(roomPageUrl(TOKEN), `room.html?room=${encodeURIComponent(TOKEN)}`);
});

test("installed clients fail closed on incompatible backend bootstrap", () => {
  const valid = {
    protocol: MOBILE_PROTOCOL, minimum_build: MOBILE_BUILD,
    public_origin: PUBLIC_ORIGIN, account: "none", lifecycle: "foreground",
  };
  assert.equal(validateBootstrap(valid, MOBILE_BUILD), true);
  assert.equal(validateBootstrap({...valid, protocol: 2}, MOBILE_BUILD), false);
  assert.equal(validateBootstrap({...valid, minimum_build: MOBILE_BUILD + 1}, MOBILE_BUILD), false);
  assert.equal(validateBootstrap({...valid, public_origin: "https://attacker.test"}, MOBILE_BUILD), false);
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

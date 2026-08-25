import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MOBILE_AUTH_SCHEME, MOBILE_BUILD, MOBILE_PROTOCOL, PARTICIPANT_LIMIT, PUBLIC_ORIGIN,
  apiPath, createSecureHostStorage, isSessionToken, parseNativeAuthLink, parseRoomLink,
  roomPageUrl, validateBootstrap, websocketPath,
} from "../src/runtime-core.mjs";

const TOKEN = "Abcdefghijklmnopqrstuvwx.1786750205.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";
const FUTURE = Math.floor(Date.now() / 1000) + 600;
const USER = "TestHostUser0123456789";
const NONCE = "ABCDEFGHIJKLMNOPQRSTUV";
const CHALLENGE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";
const SIGNATURE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";
const HANDOFF = `nh2.google.${USER}.${FUTURE}.${NONCE}.${CHALLENGE}.${SIGNATURE}`;
const SESSION = `s1.${USER}.${FUTURE}.${CHALLENGE}`;

test("deep links accept only exact signed public room URLs", () => {
  assert.deepEqual(
    parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}`), {token: TOKEN, mode: "video"}
  );
  assert.equal(parseRoomLink(`https://attacker.test/room/${TOKEN}`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}.attacker.test/room/${TOKEN}`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?copy=1`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/rooms/${TOKEN}`), null);
  assert.equal(parseRoomLink("not a url"), null);
});

test("deep links preserve mode and accept only bounded legacy voice labels", () => {
  assert.deepEqual(
    parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=voice`), {token: TOKEN, mode: "voice"}
  );
  assert.deepEqual(
    parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=chat`), {token: TOKEN, mode: "chat"}
  );
  // This is compatibility for already-issued URLs only. roomPageUrl below is
  // the generator and deliberately cannot create the label anymore.
  assert.deepEqual(
    parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=voice&n=Maria`),
    {token: TOKEN, mode: "voice", name: "Maria"}
  );
  // An unknown shell name is furniture this build does not have, not a reason
  // to drop an otherwise valid invitation.
  assert.deepEqual(
    parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=hologram`), {token: TOKEN, mode: "video"}
  );
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=chat&n=Maria`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=voice&n=${"x".repeat(41)}`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=voice&copy=1`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=voice&m=chat`), null);
  assert.equal(parseRoomLink(`${PUBLIC_ORIGIN}/room/${TOKEN}?m=voice&n=A&n=B`), null);
});

test("native auth completion accepts only the app scheme and matching provider", () => {
  assert.deepEqual(
    parseNativeAuthLink(`${MOBILE_AUTH_SCHEME}://auth/google#handoff=${HANDOFF}`),
    {handoff: HANDOFF, provider: "google"}
  );
  assert.deepEqual(
    parseNativeAuthLink(`${MOBILE_AUTH_SCHEME}://auth/google#auth=failed`),
    {error: "failed", provider: "google"}
  );
  assert.equal(parseNativeAuthLink(
    `https://attacker.test/mobile-auth-complete#handoff=${HANDOFF}`
  ), null);
  assert.equal(parseNativeAuthLink(
    `${PUBLIC_ORIGIN}/mobile-auth-complete#handoff=${HANDOFF}`
  ), null);
  assert.equal(parseNativeAuthLink(
    `${MOBILE_AUTH_SCHEME}://auth/apple#handoff=${HANDOFF}`
  ), null);
  assert.equal(parseNativeAuthLink(
    `${MOBILE_AUTH_SCHEME}://auth/google?handoff=${HANDOFF}`
  ), null);
  assert.equal(parseNativeAuthLink(
    `${MOBILE_AUTH_SCHEME}://auth/google#handoff=${HANDOFF}&extra=1`
  ), null);
  assert.equal(isSessionToken(SESSION), true);
  assert.equal(isSessionToken(`s1.${USER}.1.${CHALLENGE}`), false);
});

test("native traffic stays on the versioned backend seam", () => {
  assert.equal(apiPath("/api/capabilities", true), "/api/v1/capabilities");
  assert.equal(apiPath("/api/reports", true), "/api/v1/reports");
  assert.equal(apiPath("/api/me", true), "/api/v1/me");
  assert.equal(apiPath("/api/account/delete", true), "/api/v1/account/delete");
  assert.equal(apiPath("/auth/logout", true), "/api/v1/auth/logout");
  assert.equal(apiPath("/auth/google/start", true), "/auth/native/google/start");
  assert.equal(apiPath("/auth/apple/start", true), "/auth/native/apple/start");
  assert.equal(apiPath("/tts", true), "/api/v1/tts");
  assert.equal(apiPath("/api/capabilities", false), "/api/capabilities");
  assert.equal(apiPath("/auth/google/start", false), "/auth/google/start");
  assert.throws(() => apiPath("/api/not-a-real-route", true), /Unsupported native API path/);
  assert.equal(websocketPath(TOKEN, true), `/ws/v1/${TOKEN}`);
  assert.equal(websocketPath(TOKEN, false), `/ws/${TOKEN}`);
  assert.equal(roomPageUrl(TOKEN), `room.html?room=${encodeURIComponent(TOKEN)}`);
  assert.equal(roomPageUrl(TOKEN, "voice"), `room.html?room=${encodeURIComponent(TOKEN)}&m=voice`);
  // Extra legacy metadata is ignored even if old calling code supplies it.
  assert.equal(
    roomPageUrl(TOKEN, "voice", "Maria"),
    `room.html?room=${encodeURIComponent(TOKEN)}&m=voice`
  );
  assert.doesNotMatch(roomPageUrl(TOKEN, "voice", "Maria"), /[?&]n=/);
  // Video is the shell an older link already opens, so it stays off the URL.
  assert.equal(roomPageUrl(TOKEN, "video"), roomPageUrl(TOKEN));
  assert.equal(roomPageUrl(TOKEN, "hologram"), roomPageUrl(TOKEN));
});

test("installed clients fail closed on incompatible backend bootstrap", () => {
  const valid = {
    protocol: MOBILE_PROTOCOL, minimum_client_build: MOBILE_BUILD,
    public_origin: PUBLIC_ORIGIN, account_mode: "session", call_lifecycle: "foreground",
    max_room_participants: PARTICIPANT_LIMIT,
  };
  assert.equal(validateBootstrap(valid, MOBILE_BUILD), true);
  assert.equal(validateBootstrap({...valid, protocol: 2}, MOBILE_BUILD), false);
  assert.equal(validateBootstrap({...valid, minimum_client_build: MOBILE_BUILD + 1}, MOBILE_BUILD), false);
  assert.equal(validateBootstrap({...valid, public_origin: "https://attacker.test"}, MOBILE_BUILD), false);
  assert.equal(validateBootstrap({...valid, max_room_participants: 4}, MOBILE_BUILD), false);
  // Starting a call needs an account now. A backend still answering "none" is
  // an older deployment this build must refuse rather than half-work against.
  assert.equal(validateBootstrap({...valid, account_mode: "none"}, MOBILE_BUILD), false);
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

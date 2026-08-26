import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../www/dashboard-room-model.js", import.meta.url), "utf8");
const ROOM_ID = "A".repeat(24);
const OTHER_ROOM_ID = "C".repeat(24);
const EXPIRES = 1999999999;
const SIGNATURE = "B".repeat(43);
const OTHER_SIGNATURE = "D".repeat(43);

function roomRecord(overrides = {}) {
  return {
    path: `/room/${ROOM_ID}.${EXPIRES}.${SIGNATURE}`,
    host_control: `hc1.${ROOM_ID}.${EXPIRES}.${OTHER_SIGNATURE}`,
    expires_at: EXPIRES,
    mode: "voice",
    ...overrides,
  };
}

function loadModel(savedValue = null, {
  saveSucceeds = true,
  deleteSucceeds = true,
  loadFails = false,
} = {}) {
  let stored = savedValue;
  let writes = 0;
  let forgets = 0;
  const context = {window: {}, URL};
  vm.runInNewContext(source, context, {filename: "dashboard-room-model.js"});
  const runtime = {
    inviteUrl: room => new URL(room.path, "https://lingua.test").toString(),
    loadHostRoom: async () => {
      if (loadFails) throw new Error("storage unavailable");
      return stored;
    },
    saveHostRoom: async value => {
      writes++;
      if (!saveSucceeds) return false;
      stored = value;
      return true;
    },
    forgetHostRoom: async () => {
      forgets++;
      if (deleteSucceeds) stored = null;
    },
  };
  const model = context.window.LinguaDashboardRoomModel.create(runtime);
  return {model, state: () => ({stored, writes, forgets})};
}

test("room model accepts only a matching same-room capability tuple", () => {
  const {model} = loadModel();
  assert.equal(model.valid(roomRecord()), true);

  for (const invalid of [
    roomRecord({path: `https://evil.test/room/${ROOM_ID}.${EXPIRES}.${SIGNATURE}`}),
    roomRecord({path: `/room/${ROOM_ID}.${EXPIRES}.${SIGNATURE}?next=https://evil.test`}),
    roomRecord({path: `/room/${ROOM_ID}.${EXPIRES}.${SIGNATURE}/extra`}),
    roomRecord({host_control: `hc1.${OTHER_ROOM_ID}.${EXPIRES}.${OTHER_SIGNATURE}`}),
    roomRecord({host_control: `hc1.${ROOM_ID}.${EXPIRES + 1}.${OTHER_SIGNATURE}`}),
    roomRecord({expires_at: EXPIRES + 1}),
    roomRecord({host_control: "host-control-test"}),
    roomRecord({path: "/room/not-a-token"}),
  ]) assert.equal(model.valid(invalid), false);
});

test("invalid persisted capability records never become invite URLs or survive load/save", async () => {
  const malicious = roomRecord({
    path: `https://evil.test/room/${ROOM_ID}.${EXPIRES}.${SIGNATURE}`,
  });
  const h = loadModel(JSON.stringify(malicious));

  assert.equal(await h.model.load(), null);
  assert.equal(h.state().stored, null);
  assert.equal(h.state().forgets, 1);
  assert.equal(await h.model.save(malicious), false);
  assert.equal(h.state().writes, 0);
  assert.throws(() => h.model.inviteUrl(malicious), /invalid room capability/);

  const malformed = loadModel("{not-json");
  assert.equal(await malformed.model.load(), null);
  assert.equal(malformed.state().stored, null);
  assert.equal(malformed.state().forgets, 1);
});

test("valid persisted capabilities survive load without destructive cleanup", async () => {
  const record = roomRecord();
  const h = loadModel(JSON.stringify(record));
  const loaded = await h.model.load();
  assert.equal(loaded.path, record.path);
  assert.equal(loaded.host_control, record.host_control);
  assert.equal(loaded.expires_at, record.expires_at);
  assert.equal(h.state().forgets, 0);
});

test("storage read failures propagate instead of masquerading as an empty slot", async () => {
  const h = loadModel(JSON.stringify(roomRecord()), {loadFails: true});
  await assert.rejects(() => h.model.load(), /storage unavailable/);
  assert.equal(h.state().forgets, 0,
    "an unread slot cannot be destructively cleaned up or declared empty");
});

test("valid invite URLs remain on the public origin and add only the normalized mode", async () => {
  const h = loadModel();
  const record = roomRecord();
  assert.equal(await h.model.save(record), true);
  assert.equal(h.state().writes, 1);

  const invite = new URL(h.model.inviteUrl(record));
  assert.equal(invite.origin, "https://lingua.test");
  assert.equal(invite.pathname, record.path);
  assert.equal(invite.searchParams.get("m"), "voice");
  assert.deepEqual([...invite.searchParams.keys()], ["m"]);
});

test("retirement overwrites a bearer before best-effort deletion", async () => {
  const record = roomRecord();
  const h = loadModel(JSON.stringify(record), {deleteSucceeds: false});

  assert.equal(await h.model.forget(), true,
    "a checked overwrite is sufficient even when native deletion silently fails");
  assert.equal(h.state().stored, '{"revoked":true}');
  assert.equal(h.state().forgets, 1);
  assert.equal(h.model.valid(JSON.parse(h.state().stored)), false,
    "the surviving tombstone cannot be used as room administration");
});

test("retirement fails closed when the bearer cannot be overwritten or deleted", async () => {
  const persisted = JSON.stringify(roomRecord());
  const h = loadModel(persisted, {saveSucceeds: false, deleteSucceeds: false});

  assert.equal(await h.model.forget(), false);
  assert.equal(h.state().stored, persisted,
    "callers can detect that a usable persisted bearer may still remain");
  assert.equal(h.state().writes, 1);
  assert.equal(h.state().forgets, 1);
});

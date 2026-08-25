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

function loadModel(savedValue = null) {
  let stored = savedValue;
  let writes = 0;
  let forgets = 0;
  const context = {window: {}, URL};
  vm.runInNewContext(source, context, {filename: "dashboard-room-model.js"});
  const runtime = {
    inviteUrl: room => new URL(room.path, "https://lingua.test").toString(),
    loadHostRoom: async () => stored,
    saveHostRoom: async value => { stored = value; writes++; return true; },
    forgetHostRoom: async () => { stored = null; forgets++; },
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
  assert.equal(await h.model.save(malicious), false);
  assert.equal(h.state().writes, 0);
  assert.throws(() => h.model.inviteUrl(malicious), /invalid room capability/);
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

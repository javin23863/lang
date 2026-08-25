import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";
const BLOCK_A = "A".repeat(22);
const BLOCK_B = "B".repeat(22);

type SocketHarness = {
  socket: WebSocket;
  next: (type: string) => Promise<Record<string, unknown>>;
  closed: Promise<CloseEvent>;
};

async function createRoom(): Promise<{path: string; hostControl: string}> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: {Origin: ORIGIN, Cookie: await hostSessionCookie()},
  });
  expect(response.status).toBe(201);
  const body = await response.json<{path: string; host_control: string}>();
  return {path: body.path, hostControl: body.host_control};
}

async function socketFor(path: string): Promise<SocketHarness> {
  const response = await exports.default.fetch(
    `${ORIGIN}${path.replace("/room/", "/ws/")}`,
    {headers: {Origin: ORIGIN, Upgrade: "websocket"}},
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const received: Record<string, unknown>[] = [];
  const readers: Array<{type: string; resolve: (message: Record<string, unknown>) => void}> = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    const index = readers.findIndex(reader => reader.type === message.type);
    if (index >= 0) readers.splice(index, 1)[0].resolve(message);
    else received.push(message);
  });
  const next = (type: string) => {
    const index = received.findIndex(message => message.type === type);
    if (index >= 0) return Promise.resolve(received.splice(index, 1)[0]);
    return new Promise<Record<string, unknown>>(resolve => readers.push({type, resolve}));
  };
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener("close", resolve));
  return {socket, next, closed};
}

async function join(
  path: string,
  blockId?: string,
  blockedIds?: string[],
): Promise<SocketHarness & {id: string; welcome: Record<string, unknown>}> {
  const client = await socketFor(path);
  const message: Record<string, unknown> = {
    type: "join", locale: "en-US", name: "en", voice_profile: "en-us-af-heart",
  };
  if (blockId !== undefined) message.block_id = blockId;
  if (blockedIds !== undefined) message.blocked_ids = blockedIds;
  client.socket.send(JSON.stringify(message));
  const welcome = await client.next("welcome");
  return {...client, id: String(welcome.id), welcome};
}

async function participantCount(hostControl: string): Promise<number> {
  const response = await exports.default.fetch(`${ORIGIN}/api/room-control`, {
    headers: {Origin: ORIGIN, Authorization: `Bearer ${hostControl}`},
  });
  expect(response.status).toBe(200);
  return (await response.json<{participant_count: number}>()).participant_count;
}

describe("participant safety blocking", () => {
  it("relays only the pseudonymous peer safety id through presence and signalling", async () => {
    const {path} = await createRoom();
    const first = await join(path, BLOCK_A, []);
    const second = await join(path, BLOCK_B, []);

    const peerJoin = await first.next("peer_join");
    const peers = second.welcome.peers as Array<Record<string, unknown>>;
    expect(peers).toHaveLength(1);
    expect(peers[0].block_id).toBe(BLOCK_A);
    expect(peers[0]).not.toHaveProperty("blocked_ids");
    expect(peerJoin.block_id).toBe(BLOCK_B);
    expect(peerJoin).not.toHaveProperty("blocked_ids");

    second.socket.send(JSON.stringify({type: "signal", to: first.id, data: {probe: true}}));
    const signal = await first.next("signal");
    expect(signal.from).toBe(second.id);
    expect(signal.from_block_id).toBe(BLOCK_B);
    expect(signal).not.toHaveProperty("blocked_ids");

    first.socket.close(1000, "done");
    second.socket.close(1000, "done");
  });

  it("rejects a join before admission when either participant has blocked the other", async () => {
    const firstRoom = await createRoom();
    const first = await join(firstRoom.path, BLOCK_A, [BLOCK_B]);
    const rejected = await socketFor(firstRoom.path);
    rejected.socket.send(JSON.stringify({
      type: "join", locale: "en-US", name: "blocked", voice_profile: "en-us-af-heart",
      block_id: BLOCK_B, blocked_ids: [],
    }));
    expect(await rejected.next("peer_blocked")).toEqual({type: "peer_blocked"});
    expect((await rejected.closed).code).toBe(1008);
    expect(await participantCount(firstRoom.hostControl)).toBe(1);
    first.socket.close(1000, "done");

    const secondRoom = await createRoom();
    const allowed = await join(secondRoom.path, BLOCK_A, []);
    const selfBlocking = await socketFor(secondRoom.path);
    selfBlocking.socket.send(JSON.stringify({
      type: "join", locale: "en-US", name: "blocked", voice_profile: "en-us-af-heart",
      block_id: BLOCK_B, blocked_ids: [BLOCK_A],
    }));
    expect(await selfBlocking.next("peer_blocked")).toEqual({type: "peer_blocked"});
    expect((await selfBlocking.closed).code).toBe(1008);
    expect(await participantCount(secondRoom.hostControl)).toBe(1);
    allowed.socket.close(1000, "done");
  });

  it("keeps legacy clients compatible with an ephemeral room-only safety id", async () => {
    const {path} = await createRoom();
    const legacy = await join(path);
    const current = await join(path, BLOCK_B, []);
    const peers = current.welcome.peers as Array<Record<string, unknown>>;
    expect(peers[0].block_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(peers[0].block_id).not.toBe(BLOCK_B);
    legacy.socket.close(1000, "done");
    current.socket.close(1000, "done");
  });

  it("fails closed on malformed safety identifiers and oversized block lists", async () => {
    const malformedRoom = await createRoom();
    const malformed = await socketFor(malformedRoom.path);
    malformed.socket.send(JSON.stringify({
      type: "join", locale: "en-US", name: "bad", voice_profile: "en-us-af-heart",
      block_id: "not-valid", blocked_ids: [],
    }));
    expect((await malformed.closed).code).toBe(1008);

    const oversizedRoom = await createRoom();
    const oversized = await socketFor(oversizedRoom.path);
    oversized.socket.send(JSON.stringify({
      type: "join", locale: "en-US", name: "bad", voice_profile: "en-us-af-heart",
      block_id: BLOCK_A, blocked_ids: Array.from({length: 129}, (_, index) =>
        `${String(index).padStart(22, "0")}`),
    }));
    expect((await oversized.closed).code).toBe(1008);
  });
});

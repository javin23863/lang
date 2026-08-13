import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

async function createRoom(): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { Origin: ORIGIN }
  });
  expect(response.status).toBe(201);
  return (await response.json<{ path: string }>()).path;
}

type SocketClient = {
  socket: WebSocket;
  next: () => Promise<Record<string, unknown>>;
};

async function openSocket(path: string): Promise<SocketClient> {
  const response = await exports.default.fetch(
    `${ORIGIN}${path.replace("/room/", "/ws/")}`,
    { headers: { Origin: ORIGIN, Upgrade: "websocket" } }
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const messages: Record<string, unknown>[] = [];
  const readers: ((message: Record<string, unknown>) => void)[] = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    const reader = readers.shift();
    if (reader) reader(message); else messages.push(message);
  });
  return {
    socket,
    next: () => messages.length
      ? Promise.resolve(messages.shift()!)
      : new Promise(resolve => readers.push(resolve))
  };
}

async function join(client: SocketClient, lang: "en" | "es", name: string,
                    voiceStyle: "female" | "male") {
  client.socket.send(JSON.stringify({
    type: "join", lang, name, voice_style: voiceStyle
  }));
  return client.next();
}

describe("public room WebSocket interface", () => {
  it("rejects a bad handshake, origin, bearer, and browser-authored caption", async () => {
    const path = await createRoom();
    const wsPath = path.replace("/room/", "/ws/");

    const noUpgrade = await exports.default.fetch(`${ORIGIN}${wsPath}`, {
      headers: { Origin: ORIGIN }
    });
    expect(noUpgrade.status).toBe(426);
    const wrongOrigin = await exports.default.fetch(`${ORIGIN}${wsPath}`, {
      headers: { Origin: "https://attacker.test", Upgrade: "websocket" }
    });
    expect(wrongOrigin.status).toBe(403);
    const forged = await exports.default.fetch(`${ORIGIN}${wsPath.slice(0, -1)}A`, {
      headers: { Origin: ORIGIN, Upgrade: "websocket" }
    });
    expect(forged.status).toBe(401);

    const a = await openSocket(path);
    const welcome = await join(a, "en", "A", "female");
    expect(welcome.type).toBe("welcome");
    const closed = new Promise<CloseEvent>(resolve => a.socket.addEventListener("close", resolve));
    a.socket.send(JSON.stringify({
      type: "caption", speaker: "forged", final: true, original: "injected"
    }));
    expect((await closed).code).toBe(1008);
  });

  it("keeps presence, voice metadata, and signalling inside one deterministic room", async () => {
    const roomA = await createRoom();
    const roomB = await createRoom();
    const a1 = await openSocket(roomA);
    const a1Welcome = await join(a1, "en", "A1", "female");
    expect(a1Welcome).toMatchObject({ type: "welcome", peers: [], langs: ["en", "es"] });

    const b1 = await openSocket(roomB);
    const b1Welcome = await join(b1, "es", "B1", "male");
    expect(b1Welcome).toMatchObject({ type: "welcome", peers: [] });

    const a2 = await openSocket(roomA);
    const a2Welcome = await join(a2, "es", "A2", "male");
    expect(a2Welcome).toMatchObject({
      type: "welcome",
      peers: [{ id: a1Welcome.id, lang: "en", name: "A1", voice_style: "female" }]
    });
    expect(await a1.next()).toMatchObject({
      type: "peer_join", id: a2Welcome.id, voice_style: "male"
    });

    a1.socket.send(JSON.stringify({
      type: "signal", to: b1Welcome.id,
      data: { candidate: { candidate: "cross-room" } }
    }));
    b1.socket.send(JSON.stringify({ type: "set_voice_style", voice_style: "female" }));
    expect(await b1.next()).toMatchObject({
      type: "peer_update", id: b1Welcome.id, voice_style: "female"
    });

    a1.socket.send(JSON.stringify({
      type: "signal", to: a2Welcome.id,
      data: { description: { type: "offer", sdp: "v=0" } }
    }));
    expect(await a2.next()).toMatchObject({
      type: "signal", from: a1Welcome.id,
      data: { description: { type: "offer", sdp: "v=0" } }
    });

    const roomId = roomA.split("/").pop()!.split(".")[0];
    const state = await runInDurableObject(env.ROOMS.getByName(roomId), async (_instance, ctx) => ({
      attachments: ctx.getWebSockets("browser").map(socket => socket.deserializeAttachment()),
      storage: await ctx.storage.list()
    }));
    expect(state.attachments).toHaveLength(2);
    expect(state.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: a1Welcome.id, joined: true, voiceStyle: "female" }),
      expect.objectContaining({ id: a2Welcome.id, joined: true, voiceStyle: "male" })
    ]));
    expect([...state.storage.keys()]).toEqual(["expiresAt"]);

    a1.socket.close(1000, "done");
    a2.socket.close(1000, "done");
    b1.socket.close(1000, "done");
  });

  it("caps a room at four joined participants", async () => {
    const room = await createRoom();
    const held: SocketClient[] = [];
    for (let index = 0; index < 4; index++) {
      const client = await openSocket(room);
      held.push(client);
      expect(await join(client, "en", `P${index}`, "female")).toMatchObject({ type: "welcome" });
      for (const earlier of held.slice(0, -1)) await earlier.next();
    }
    const fifth = await openSocket(room);
    fifth.socket.send(JSON.stringify({ type: "join", lang: "en", name: "P4", voice_style: "male" }));
    expect(await fifth.next()).toEqual({ type: "room_full", limit: 4 });
    const closed = new Promise<CloseEvent>(resolve => fifth.socket.addEventListener("close", resolve));
    expect((await closed).code).toBe(1013);
    for (const client of held) client.socket.close(1000, "done");
  });

  it("alarms at token expiry and removes the Durable Object expiry record", async () => {
    const room = await createRoom();
    const client = await openSocket(room);
    await join(client, "en", "A", "female");
    const token = room.split("/").pop()!;
    const [roomId, expiresRaw] = token.split(".");
    const stub = env.ROOMS.getByName(roomId);
    const alarm = await runInDurableObject(stub, async (_instance, ctx) =>
      ctx.storage.getAlarm());
    expect(alarm).toBe(Number(expiresRaw) * 1000);
    const closed = new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await closed).code).toBe(1008);
    const keys = await runInDurableObject(stub, async (_instance, ctx) =>
      [...(await ctx.storage.list()).keys()]);
    expect(keys).toEqual([]);
  });
});

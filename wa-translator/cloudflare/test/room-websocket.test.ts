import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";

async function createRoom(): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: await hostSessionCookie() }
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

const profileFor = {
  en: { locale: "en-US", female: "en-us-af-heart", male: "en-us-am-michael" },
  es: { locale: "es-ES", female: "es-ef-dora", male: "es-em-alex" },
} as const;

async function join(client: SocketClient, lang: keyof typeof profileFor, name: string,
                    voiceKind: "female" | "male") {
  const profile = profileFor[lang];
  client.socket.send(JSON.stringify({
    type: "join", locale: profile.locale, name, voice_profile: profile[voiceKind]
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
    const signatureStart = wsPath.lastIndexOf(".") + 1;
    const forgedSignatureHead = wsPath[signatureStart] === "A" ? "B" : "A";
    const forgedPath = `${wsPath.slice(0, signatureStart)}${forgedSignatureHead}`
      + wsPath.slice(signatureStart + 1);
    const forged = await exports.default.fetch(`${ORIGIN}${forgedPath}`, {
      headers: { Origin: ORIGIN, Upgrade: "websocket" }
    });
    expect(forged.status).toBe(401);

    const a = await openSocket(path);
    const welcome = await join(a, "en", "A", "female");
    expect(welcome).toMatchObject({type: "welcome", participant_limit: 2});
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
    expect(a1Welcome).toMatchObject({
      type: "welcome", peers: [], participant_limit: 2,
      catalog_revision: "2026-08-14-m2m100-55c2e61-free84-tts13"
    });

    const b1 = await openSocket(roomB);
    const b1Welcome = await join(b1, "es", "B1", "male");
    expect(b1Welcome).toMatchObject({ type: "welcome", peers: [], participant_limit: 2 });

    const a2 = await openSocket(roomA);
    const a2Welcome = await join(a2, "es", "A2", "male");
    expect(a2Welcome).toMatchObject({
      type: "welcome",
      participant_limit: 2,
      peers: [{ id: a1Welcome.id, lang: "en", name: "A1", voice_profile: "en-us-af-heart" }]
    });
    expect(await a1.next()).toMatchObject({
      type: "peer_join", id: a2Welcome.id, voice_profile: "es-em-alex", participant_limit: 2
    });

    a1.socket.send(JSON.stringify({
      type: "signal", to: b1Welcome.id,
      data: { candidate: { candidate: "cross-room" } }
    }));
    b1.socket.send(JSON.stringify({
      type: "set_voice_profile", voice_profile: "es-ef-dora"
    }));
    expect(await b1.next()).toMatchObject({
      type: "peer_update", id: b1Welcome.id, voice_profile: "es-ef-dora"
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
      expect.objectContaining({ id: a1Welcome.id, joined: true, voiceProfileId: "en-us-af-heart" }),
      expect.objectContaining({ id: a2Welcome.id, joined: true, voiceProfileId: "es-em-alex" })
    ]));
    // Expiry, the owning account id, and the call clock. Nothing else survives
    // in a room: no transcript, no caption, no participant identity, and
    // nothing that names a person - the owner is already a one-way digest.
    expect([...state.storage.keys()].sort()).toEqual(["activeSince", "expiresAt", "owner"]);
    expect(state.storage.get("owner")).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(state.storage.get("activeSince")).toBeGreaterThan(0);

    a1.socket.close(1000, "done");
    a2.socket.close(1000, "done");
    b1.socket.close(1000, "done");
  });

  it("allows bounded WebRTC SDP while retaining strict control-message caps", async () => {
    const room = await createRoom();
    const sender = await openSocket(room);
    const senderWelcome = await join(sender, "en", "Sender", "female");
    const receiver = await openSocket(room);
    const receiverWelcome = await join(receiver, "es", "Receiver", "male");
    await sender.next(); // peer_join

    const sdp = `v=0\r\n${"a=x:".repeat(2200)}`;
    sender.socket.send(JSON.stringify({
      type: "signal", to: receiverWelcome.id,
      data: { description: { type: "offer", sdp } }
    }));
    expect(await receiver.next()).toMatchObject({
      type: "signal", from: senderWelcome.id,
      data: { description: { type: "offer", sdp } }
    });
    sender.socket.send(JSON.stringify({ type: "heartbeat" }));
    expect(await sender.next()).toMatchObject({ type: "presence", participant_limit: 2 });
    sender.socket.close(1000, "done");
    receiver.socket.close(1000, "done");

    // Size enforcement does not need extra people in the call. Give each case
    // its own two-party room so the test never depends on a third join.
    const controlRoom = await createRoom();
    const oversizedControl = await openSocket(controlRoom);
    await join(oversizedControl, "en", "Control", "female");
    const controlClosed = new Promise<CloseEvent>(resolve =>
      oversizedControl.socket.addEventListener("close", resolve));
    oversizedControl.socket.send(JSON.stringify({
      type: "heartbeat", padding: "x".repeat(9000)
    }));
    expect((await controlClosed).code).toBe(1009);

    const signalRoom = await createRoom();
    const oversizedSignal = await openSocket(signalRoom);
    await join(oversizedSignal, "en", "Signal", "female");
    const signalClosed = new Promise<CloseEvent>(resolve =>
      oversizedSignal.socket.addEventListener("close", resolve));
    oversizedSignal.socket.send(JSON.stringify({
      type: "signal", to: "ABCDEFGHIJKLMNOP",
      data: { description: { type: "offer", sdp: "x".repeat(65536) } }
    }));
    expect((await signalClosed).code).toBe(1009);
  });

  it("caps a room at exactly two joined participants", async () => {
    const room = await createRoom();
    const first = await openSocket(room);
    const firstWelcome = await join(first, "en", "P0", "female");
    expect(firstWelcome).toMatchObject({
      type: "welcome", participant_count: 1, participant_limit: 2
    });

    const second = await openSocket(room);
    expect(await join(second, "es", "P1", "male")).toMatchObject({
      type: "welcome", participant_count: 2, participant_limit: 2
    });
    await first.next(); // peer_join

    const third = await openSocket(room);
    third.socket.send(JSON.stringify({
      type: "join", locale: "en-US", name: "P2", voice_profile: "en-us-am-michael"
    }));
    expect(await third.next()).toEqual({
      type: "room_full", limit: 2, participant_count: 2
    });
    const closed = new Promise<CloseEvent>(resolve => third.socket.addEventListener("close", resolve));
    expect((await closed).code).toBe(1013);
    first.socket.close(1000, "done");
    second.socket.close(1000, "done");
  });

  it("releases an explicit Leave immediately and reports the new participant count", async () => {
    const room = await createRoom();
    const a = await openSocket(room);
    const aWelcome = await join(a, "en", "A", "female");
    expect(aWelcome).toMatchObject({
      type: "welcome", participant_count: 1, participant_limit: 2
    });

    const b = await openSocket(room);
    const bWelcome = await join(b, "es", "B", "male");
    expect(bWelcome).toMatchObject({ type: "welcome", participant_count: 2, participant_limit: 2 });
    expect(await a.next()).toMatchObject({
      type: "peer_join", id: bWelcome.id, participant_count: 2, participant_limit: 2
    });

    const bClosed = new Promise<CloseEvent>(resolve =>
      b.socket.addEventListener("close", resolve));
    b.socket.send(JSON.stringify({ type: "leave" }));
    expect(await a.next()).toMatchObject({
      type: "peer_leave", id: bWelcome.id, participant_count: 1, participant_limit: 2
    });
    expect((await bClosed).code).toBe(1000);

    const replacement = await openSocket(room);
    expect(await join(replacement, "es", "Replacement", "female")).toMatchObject({
      type: "welcome",
      participant_count: 2,
      participant_limit: 2,
      peers: [expect.objectContaining({ id: aWelcome.id })]
    });
    a.socket.close(1000, "done");
    replacement.socket.close(1000, "done");
  });

  it("releases a normal browser WebSocket close immediately", async () => {
    const room = await createRoom();
    const survivor = await openSocket(room);
    const survivorWelcome = await join(survivor, "en", "Survivor", "female");
    const closing = await openSocket(room);
    const closingWelcome = await join(closing, "es", "Closing", "male");
    await survivor.next(); // peer_join

    closing.socket.close(1000, "page closed");
    expect(await survivor.next()).toMatchObject({
      type: "peer_leave", id: closingWelcome.id, participant_count: 1, participant_limit: 2
    });

    const replacement = await openSocket(room);
    expect(await join(replacement, "es", "Replacement", "female")).toMatchObject({
      type: "welcome",
      participant_count: 2,
      participant_limit: 2,
      peers: [expect.objectContaining({ id: survivorWelcome.id })]
    });
    survivor.socket.close(1000, "done");
    replacement.socket.close(1000, "done");
  });

  it("reclaims silent half-open slots after the documented 90 second lease", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const joinedAt = Date.now();
      const room = await createRoom();
      const held: SocketClient[] = [];
      for (let index = 0; index < 2; index++) {
        const client = await openSocket(room);
        held.push(client);
        expect(await join(client, "en", `Silent${index}`, "female")).toMatchObject({
          type: "welcome",
          participant_limit: 2,
          presence_lease_ms: 90_000,
          heartbeat_interval_ms: 10_000
        });
        for (const earlier of held.slice(0, -1)) await earlier.next();
      }

      vi.setSystemTime(joinedAt + 90_001);
      const replacement = await openSocket(room);
      expect(await join(replacement, "es", "Replacement", "male")).toMatchObject({
        type: "welcome", peers: [], participant_count: 1, participant_limit: 2
      });

      for (const client of held) client.socket.close(1000, "done");
      replacement.socket.close(1000, "done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not evict a background mobile client at a one-minute timer cadence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const joinedAt = Date.now();
      const room = await createRoom();
      const foreground = await openSocket(room);
      await join(foreground, "en", "Foreground", "female");
      const background = await openSocket(room);
      await join(background, "es", "Background", "male");
      await foreground.next(); // peer_join

      // Hidden mobile browsers commonly coalesce timers to one wake per minute.
      // A foreground heartbeat must not sweep that still-connected peer first.
      vi.setSystemTime(joinedAt + 60_000);
      foreground.socket.send(JSON.stringify({ type: "heartbeat" }));
      expect(await foreground.next()).toMatchObject({
        type: "presence", participant_count: 2, participant_limit: 2
      });
      background.socket.send(JSON.stringify({ type: "heartbeat" }));
      expect(await background.next()).toMatchObject({
        type: "presence", participant_count: 2, participant_limit: 2
      });

      foreground.socket.close(1000, "done");
      background.socket.close(1000, "done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews an active participant heartbeat while reclaiming a silent peer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const joinedAt = Date.now();
      const room = await createRoom();
      const active = await openSocket(room);
      const activeWelcome = await join(active, "en", "Active", "female");
      const silent = await openSocket(room);
      const silentWelcome = await join(silent, "es", "Silent", "male");
      await active.next(); // peer_join

      vi.setSystemTime(joinedAt + 60_000);
      active.socket.send(JSON.stringify({ type: "heartbeat" }));
      expect(await active.next()).toMatchObject({
        type: "presence", participant_count: 2, participant_limit: 2
      });

      vi.setSystemTime(joinedAt + 90_001);
      active.socket.send(JSON.stringify({ type: "heartbeat" }));
      expect(await active.next()).toMatchObject({
        type: "peer_leave", id: silentWelcome.id, participant_count: 1, participant_limit: 2
      });
      expect(await active.next()).toMatchObject({
        type: "presence", participant_count: 1, participant_limit: 2
      });

      const replacement = await openSocket(room);
      expect(await join(replacement, "es", "Replacement", "female")).toMatchObject({
        type: "welcome",
        participant_count: 2,
        participant_limit: 2,
        peers: [expect.objectContaining({ id: activeWelcome.id })]
      });
      active.socket.close(1000, "done");
      silent.socket.close(1000, "done");
      replacement.socket.close(1000, "done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reclaims eight abandoned pre-join sockets after the same 90 second lease", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const openedAt = Date.now();
      const room = await createRoom();
      const pending = await Promise.all(
        Array.from({ length: 8 }, () => openSocket(room))
      );

      vi.setSystemTime(openedAt + 90_001);
      const replacement = await openSocket(room);
      expect(await join(replacement, "en", "Replacement", "female")).toMatchObject({
        type: "welcome", peers: [], participant_count: 1, participant_limit: 2
      });

      for (const client of pending) client.socket.close(1000, "done");
      replacement.socket.close(1000, "done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("alarms at token expiry and removes the Durable Object expiry record", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const room = await createRoom();
      const client = await openSocket(room);
      await join(client, "en", "A", "female");
      const token = room.split("/").pop()!;
      const [roomId, expiresRaw] = token.split(".");
      const expiresAtMs = Number(expiresRaw) * 1000;
      const stub = env.ROOMS.getByName(roomId);
      const alarm = await runInDurableObject(stub, async (_instance, ctx) =>
        ctx.storage.getAlarm());
      expect(alarm).toBe(expiresAtMs);

      // The test helper invokes the alarm immediately. Put Date at the actual
      // scheduled instant so the wrapper takes the room-expiry branch rather
      // than the intentionally separate pre-expiry usage-retry branch.
      vi.setSystemTime(expiresAtMs);
      const closed = new Promise<CloseEvent>(resolve =>
        client.socket.addEventListener("close", resolve));
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect((await closed).code).toBe(1008);
      const keys = await runInDurableObject(stub, async (_instance, ctx) =>
        [...(await ctx.storage.list()).keys()]);
      expect(keys).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

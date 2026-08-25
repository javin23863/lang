import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";
const SECRET = "test-only-room-signing-key-32-bytes";

async function createRoom(): Promise<string> {
  const response = await env.ASSETS.fetch(new Request(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: await hostSessionCookie() },
  }));
  expect(response.status).toBe(201);
  return (await response.json<{path: string}>()).path;
}

type Client = {socket: WebSocket; events: any[]};

async function openSocket(room: string): Promise<Client> {
  const token = room.split("/").pop()!;
  const response = await env.ASSETS.fetch(new Request(`${ORIGIN}/ws/${token}`, {
    headers: {
      Upgrade: "websocket",
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "websocket",
    },
  }));
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const events: any[] = [];
  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    try { events.push(JSON.parse(event.data)); } catch { /* ignored */ }
  });
  return {socket, events};
}

async function waitFor(client: Client, type: string, timeoutMs = 1000): Promise<any> {
  const existing = client.events.find(event => event.type === type);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
    const listener = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let value: any;
      try { value = JSON.parse(event.data); } catch { return; }
      if (value.type !== type) return;
      clearTimeout(timer);
      client.socket.removeEventListener("message", listener);
      resolve(value);
    };
    client.socket.addEventListener("message", listener);
  });
}

function voiceProfile(language: string, voice: "female" | "male") {
  const profiles: Record<string, Record<string, string>> = {
    en: {female: "en-us-af-heart", male: "en-us-am-michael"},
    es: {female: "es-es-af-dora", male: "es-es-am-alex"},
    fr: {female: "fr-fr-af-siwis", male: "fr-fr-am-gilles"},
  };
  return profiles[language]?.[voice] || null;
}

async function join(client: Client, language: string, name: string, voice: "female" | "male") {
  const locale = language === "en" ? "en-US" : language === "es" ? "es-ES" : "fr-FR";
  client.socket.send(JSON.stringify({
    type: "join", locale, name, voice_profile: voiceProfile(language, voice),
  }));
  return waitFor(client, "welcome");
}

async function createJoinedPair() {
  const room = await createRoom();
  const a = await openSocket(room);
  const aw = await join(a, "en", "A", "female");
  const b = await openSocket(room);
  const bw = await join(b, "es", "B", "male");
  return {room, a, b, aw, bw};
}

describe("public room WebSocket interface", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects a bad handshake, origin, bearer, and browser-authored caption", async () => {
    const room = await createRoom();
    const token = room.split("/").pop()!;

    const wrongOrigin = await env.ASSETS.fetch(new Request(`${ORIGIN}/ws/${token}`, {
      headers: {Upgrade: "websocket", Origin: "https://attacker.test"},
    }));
    expect(wrongOrigin.status).toBe(403);

    const badBearer = await env.ASSETS.fetch(new Request(`${ORIGIN}/ws/${token}x`, {
      headers: {Upgrade: "websocket", Origin: ORIGIN},
    }));
    expect(badBearer.status).not.toBe(101);

    const client = await openSocket(room);
    const closed = new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve));
    client.socket.send(JSON.stringify({type: "caption", final: true, original: "forged"}));
    expect((await closed).code).toBe(1008);
  });

  it("keeps presence, voice metadata, and signalling inside one deterministic room", async () => {
    const {a, b, aw, bw} = await createJoinedPair();
    expect(aw).toMatchObject({
      type: "welcome", participant_count: 1, participant_limit: 2, peers: [],
    });
    expect(bw).toMatchObject({
      type: "welcome", participant_count: 2, participant_limit: 2,
      peers: [expect.objectContaining({id: aw.id, lang: "en", voice_profile: "en-us-af-heart"})],
    });

    const joined = await waitFor(a, "peer_join");
    expect(joined).toMatchObject({id: bw.id, lang: "es", participant_count: 2, participant_limit: 2});

    b.socket.send(JSON.stringify({type: "signal", to: aw.id, data: {sdp: "offer"}}));
    expect(await waitFor(a, "signal")).toMatchObject({from: bw.id, data: {sdp: "offer"}});

    a.socket.send(JSON.stringify({type: "heartbeat"}));
    expect(await waitFor(a, "presence")).toMatchObject({participant_count: 2, participant_limit: 2});

    a.socket.close(1000, "done");
    b.socket.close(1000, "done");
  });

  it("allows bounded WebRTC SDP while retaining strict control-message caps", async () => {
    const {a, b, aw, bw} = await createJoinedPair();
    const largeSdp = "v=0\r\n" + "a=x:" + "z".repeat(12_000);
    b.socket.send(JSON.stringify({type: "signal", to: aw.id, data: {sdp: largeSdp}}));
    expect(await waitFor(a, "signal")).toMatchObject({from: bw.id, data: {sdp: largeSdp}});

    const closed = new Promise<CloseEvent>(resolve => b.socket.addEventListener("close", resolve));
    b.socket.send(JSON.stringify({type: "heartbeat", padding: "x".repeat(12_000)}));
    expect((await closed).code).toBe(1009);
    a.socket.close(1000, "done");
  });

  it("caps a room at exactly two joined participants", async () => {
    const room = await createRoom();
    const a = await openSocket(room);
    await join(a, "en", "A", "female");
    const b = await openSocket(room);
    await join(b, "es", "B", "male");
    const c = await openSocket(room);
    const full = waitFor(c, "room_full");
    c.socket.send(JSON.stringify({
      type: "join", locale: "fr-FR", name: "C", voice_profile: "fr-fr-af-siwis",
    }));
    expect(await full).toMatchObject({type: "room_full", limit: 2, participant_count: 2});
    a.socket.close(1000, "done");
    b.socket.close(1000, "done");
    c.socket.close(1000, "done");
  });

  it("releases an explicit Leave immediately and reports the new participant count", async () => {
    const {a, b} = await createJoinedPair();
    const leave = waitFor(a, "peer_leave");
    b.socket.send(JSON.stringify({type: "leave"}));
    expect(await leave).toMatchObject({participant_count: 1, participant_limit: 2});
    a.socket.close(1000, "done");
  });

  it("releases a normal browser WebSocket close immediately", async () => {
    const {a, b} = await createJoinedPair();
    const leave = waitFor(a, "peer_leave");
    b.socket.close(1000, "bye");
    expect(await leave).toMatchObject({participant_count: 1, participant_limit: 2});
    a.socket.close(1000, "done");
  });

  it("reclaims silent half-open slots after the documented 90 second lease", async () => {
    vi.useFakeTimers({toFake: ["Date"]});
    try {
      const openedAt = Date.now();
      const room = await createRoom();
      const silent = await openSocket(room);
      await join(silent, "en", "Silent", "female");
      vi.setSystemTime(openedAt + 90_001);
      const replacement = await openSocket(room);
      expect(await join(replacement, "es", "Replacement", "male")).toMatchObject({
        type: "welcome", participant_count: 1, participant_limit: 2, peers: [],
      });
      silent.socket.close(1000, "done");
      replacement.socket.close(1000, "done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not evict a background mobile client at a one-minute timer cadence", async () => {
    vi.useFakeTimers({toFake: ["Date"]});
    try {
      const room = await createRoom();
      const background = await openSocket(room);
      await join(background, "en", "Background", "female");
      const foreground = await openSocket(room);
      await join(foreground, "es", "Foreground", "male");
      const started = Date.now();

      for (let elapsed = 60_000; elapsed <= 5 * 60_000; elapsed += 60_000) {
        vi.setSystemTime(started + elapsed);
        background.socket.send(JSON.stringify({type: "heartbeat"}));
        foreground.socket.send(JSON.stringify({type: "heartbeat"}));
        expect(await waitFor(background, "presence")).toMatchObject({participant_count: 2});
      }

      background.socket.close(1000, "done");
      foreground.socket.close(1000, "done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews an active participant heartbeat while reclaiming a silent peer", async () => {
    vi.useFakeTimers({toFake: ["Date"]});
    try {
      const openedAt = Date.now();
      const room = await createRoom();
      const active = await openSocket(room);
      const activeWelcome = await join(active, "en", "Active", "female");
      const silent = await openSocket(room);
      await join(silent, "es", "Silent", "male");

      vi.setSystemTime(openedAt + 60_000);
      active.socket.send(JSON.stringify({type: "heartbeat"}));
      await waitFor(active, "presence");

      vi.setSystemTime(openedAt + 90_001);
      const replacement = await openSocket(room);
      expect(await join(replacement, "fr", "Replacement", "female")).toMatchObject({
        type: "welcome",
        participant_count: 2,
        participant_limit: 2,
        peers: [expect.objectContaining({id: activeWelcome.id})],
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
    vi.useFakeTimers({toFake: ["Date"]});
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

      // runDurableObjectAlarm executes the scheduled handler immediately; the
      // production wrapper distinguishes a pre-expiry usage-retry alarm from
      // actual room expiry using Date.now(), so put the harness at the alarm's
      // scheduled instant before triggering it.
      vi.setSystemTime(expiresAtMs);
      const closed = new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve));
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
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

type Client = {
  id: string;
  peers: Array<{ id: string }>;
  socket: WebSocket;
  next: () => Promise<Record<string, any>>;
};

async function createRoom(): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST", headers: { Origin: ORIGIN }
  });
  return (await response.json<{ path: string }>()).path;
}

async function open(path: string, lang: "en" | "es" | "fr", localeOverride?: string): Promise<Client> {
  const response = await exports.default.fetch(
    `${ORIGIN}${path.replace("/room/", "/ws/")}`,
    { headers: { Origin: ORIGIN, Upgrade: "websocket" } }
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const pending: Record<string, any>[] = [];
  const readers: ((message: Record<string, any>) => void)[] = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    const message = JSON.parse(String(event.data));
    const reader = readers.shift();
    if (reader) reader(message); else pending.push(message);
  });
  const next = () => pending.length
    ? Promise.resolve(pending.shift()!)
    : new Promise<Record<string, any>>(resolve => readers.push(resolve));
  const profile = {
    en: ["en-US", "en-us-af-heart"],
    es: ["es-ES", "es-ef-dora"],
    fr: ["fr-FR", "fr-ff-siwis"],
  } as const;
  socket.send(JSON.stringify({
    type: "join", locale: localeOverride || profile[lang][0], name: lang,
    voice_profile: profile[lang][1],
  }));
  const welcome = await next();
  expect(welcome.type).toBe("welcome");
  return { id: welcome.id, peers: welcome.peers, socket, next };
}

describe("authenticated independent Modal compute proxy", () => {
  it("cancels a late compute handshake instead of orphaning its socket", async () => {
    const stub = env.ROOMS.getByName("late-compute-handshake");
    await runInDurableObject(stub, async instance => {
      const room = instance as any;
      const meta = {
        kind: "browser", id: "race", joined: true,
        locale: "en-US", lang: "en", name: "race",
        voiceProfileId: "en-us-af-heart", voiceStyle: "female"
      };
      const pending = room.ensureCompute(meta);
      room.closeCompute(meta.id);
      expect(await pending).toBeNull();
      expect(room.compute.has(meta.id)).toBe(false);
    });
  });

  it("routes speech_end to Modal so mute finalizes pending speech", async () => {
    const room = await createRoom();
    const listener = await open(room, "es");
    const speaker = await open(room, "en");
    await listener.next();
    const frame = new Uint8Array(3200);
    frame[0] = 7; // test adapter holds this marker until speech_end arrives
    speaker.socket.send(frame.buffer);
    speaker.socket.send(JSON.stringify({ type: "speech_end" }));
    expect(await listener.next()).toMatchObject({
      type: "caption", speaker: speaker.id, final: true, original: "flushed"
    });
    speaker.socket.close(1000, "done");
    listener.socket.close(1000, "done");
  });

  it("fans a server-attributed caption out and reconnects compute without dropping signalling", async () => {
    const room = await createRoom();
    const listener = await open(room, "es");
    const speaker = await open(room, "en");
    expect(speaker.peers).toEqual([expect.objectContaining({ id: listener.id })]);
    expect(await listener.next()).toMatchObject({ type: "peer_join", id: speaker.id });

    speaker.socket.send(new Uint8Array(3200).buffer);
    const first = await listener.next();
    expect(first).toMatchObject({
      type: "caption", speaker: speaker.id, speaker_lang: "en",
      final: true, original: "hello", translations: { es: "hola" }
    });
    expect(first.speaker).not.toBe("untrusted-modal-speaker");

    // The fake Modal socket closes like a replaced process. WebRTC signalling
    // still rides the room socket and must not be coupled to compute lifetime.
    speaker.socket.send(JSON.stringify({
      type: "signal", to: listener.id,
      data: { candidate: { candidate: "still-alive" } }
    }));
    expect(await listener.next()).toMatchObject({
      type: "signal", from: speaker.id,
      data: { candidate: { candidate: "still-alive" } }
    });
    expect(speaker.socket.readyState).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 600));
    speaker.socket.send(new Uint8Array(3200).buffer);
    expect(await listener.next()).toMatchObject({
      type: "caption", speaker: speaker.id, final: true
    });

    speaker.socket.close(1000, "done");
    listener.socket.close(1000, "done");
  });

  it("transcribes once and fans out only unique current listener base languages", async () => {
    const room = await createRoom();
    const spanish = await open(room, "es");
    const french = await open(room, "fr");
    await spanish.next(); // peer_join French
    const speaker = await open(room, "en");
    await spanish.next(); // peer_join English
    await french.next(); // peer_join English

    speaker.socket.send(new Uint8Array(3200).buffer);
    expect(await spanish.next()).toMatchObject({
      type: "caption", speaker: speaker.id,
      translations: { es: "hola", fr: "translated-fr" },
    });
    expect(await french.next()).toMatchObject({
      type: "caption", speaker: speaker.id,
      translations: { es: "hola", fr: "translated-fr" },
    });

    // A same-base Spanish locale does not create a second `es` target.
    const mexicanSpanish = await open(room, "es", "es-MX");
    await spanish.next();
    await french.next();
    await speaker.next();
    await new Promise(resolve => setTimeout(resolve, 600));
    speaker.socket.send(new Uint8Array(3200).buffer);
    expect(await spanish.next()).toMatchObject({
      type: "caption", speaker: speaker.id,
      translations: { es: "hola", fr: "translated-fr" },
    });

    speaker.socket.close(1000, "done");
    spanish.socket.close(1000, "done");
    french.socket.close(1000, "done");
    mexicanSpanish.socket.close(1000, "done");
  });

  it("closes oversized microphone frames", async () => {
    const room = await createRoom();
    const speaker = await open(room, "en");
    const closed = new Promise<CloseEvent>(resolve => speaker.socket.addEventListener("close", resolve));
    speaker.socket.send(new Uint8Array(32001).buffer);
    expect((await closed).code).toBe(1009);
  });

  it("closes a valid-frame PCM flood before it can occupy unbounded compute", async () => {
    const room = await createRoom();
    const speaker = await open(room, "en");
    const closed = new Promise<CloseEvent>(resolve => speaker.socket.addEventListener("close", resolve));
    for (let index = 0; index < 3; index++) {
      speaker.socket.send(new Uint8Array(32000).buffer);
    }
    expect((await closed).code).toBe(1008);
  });
});

import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";

type SocketClient = {
  socket: WebSocket;
  id: string;
  next: (type: string) => Promise<Record<string, unknown>>;
  closed: Promise<CloseEvent>;
};

async function createRoom(): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: await hostSessionCookie() }
  });
  expect(response.status).toBe(201);
  return (await response.json<{ path: string }>()).path;
}

async function counters(): Promise<{ warm: number; translate: number }> {
  const response = await env.MODAL_TEST!.fetch("https://modal.test/counters", {
    headers: { Authorization: "Bearer test-only-modal-secret" }
  });
  return response.json<{ warm: number; translate: number }>();
}

const profileFor = {
  en: { locale: "en-US", voice: "en-us-af-heart" },
  es: { locale: "es-ES", voice: "es-ef-dora" },
} as const;

async function join(
  path: string, lang: keyof typeof profileFor
): Promise<SocketClient> {
  const response = await exports.default.fetch(
    `${ORIGIN}${path.replace("/room/", "/ws/")}`,
    { headers: { Origin: ORIGIN, Upgrade: "websocket" } }
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const received: Record<string, unknown>[] = [];
  const readers: Array<{
    type: string; resolve: (message: Record<string, unknown>) => void;
  }> = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    const index = readers.findIndex(reader => reader.type === message.type);
    if (index >= 0) readers.splice(index, 1)[0].resolve(message);
    else received.push(message);
  });
  const next = (type: string) => {
    const index = received.findIndex(message => message.type === type);
    if (index >= 0) return Promise.resolve(received.splice(index, 1)[0]);
    return new Promise<Record<string, unknown>>(
      resolve => readers.push({ type, resolve })
    );
  };
  const closed = new Promise<CloseEvent>(
    resolve => socket.addEventListener("close", resolve)
  );
  const profile = profileFor[lang];
  socket.send(JSON.stringify({
    type: "join", locale: profile.locale, name: lang, voice_profile: profile.voice
  }));
  const welcome = await next("welcome");
  return { socket, id: String(welcome.id), next, closed };
}

describe("typed chat relay", () => {
  it("translates and fans out to both peers, including the sender", async () => {
    const path = await createRoom();
    const english = await join(path, "en");
    const spanish = await join(path, "es");

    english.socket.send(JSON.stringify({ type: "chat", text: "hello", cid: 0 }));
    const mine = await english.next("chat");
    const theirs = await spanish.next("chat");

    expect(mine).toEqual(theirs);
    expect(mine.speaker).toBe(english.id);
    expect(mine.speaker_lang).toBe("en");
    expect(mine.seq).toBe(1_000_000);
    expect(mine.final).toBe(true);
    expect(mine.original).toBe("hello");
    expect(mine.translations).toEqual({ es: "es:hello" });
    expect(mine.t_ms).toBeGreaterThanOrEqual(0);

    english.socket.close(1000, "done");
    spanish.socket.close(1000, "done");
  });

  it("authors speaker and sequence itself, ignoring what the client claims", async () => {
    const path = await createRoom();
    const english = await join(path, "en");
    const spanish = await join(path, "es");

    english.socket.send(JSON.stringify({
      type: "chat", text: "  spoofed  ", cid: 7,
      speaker: spanish.id, speaker_lang: "es", seq: 42, final: false,
      translations: { es: "injected" }, original: "injected"
    }));
    const delivered = await spanish.next("chat");
    expect(delivered.speaker).toBe(english.id);
    expect(delivered.speaker_lang).toBe("en");
    expect(delivered.seq).toBe(1_000_007);
    expect(delivered.final).toBe(true);
    expect(delivered.original).toBe("spoofed");
    expect(delivered.translations).toEqual({ es: "es:spoofed" });

    english.socket.close(1000, "done");
    spanish.socket.close(1000, "done");
  });

  it("costs the GPU nothing in a single-language room", async () => {
    const path = await createRoom();
    const first = await join(path, "en");
    const second = await join(path, "en");
    const before = await counters();

    first.socket.send(JSON.stringify({ type: "chat", text: "same language", cid: 1 }));
    const delivered = await second.next("chat");
    expect(delivered.original).toBe("same language");
    expect(delivered.translations).toEqual({});
    expect((await counters()).translate).toBe(before.translate);

    first.socket.close(1000, "done");
    second.socket.close(1000, "done");
  });

  it("delivers the original when Modal fails", async () => {
    const path = await createRoom();
    const english = await join(path, "en");
    const spanish = await join(path, "es");

    english.socket.send(JSON.stringify({
      type: "chat", text: "fixture-translate-down", cid: 2
    }));
    const delivered = await spanish.next("chat");
    expect(delivered.original).toBe("fixture-translate-down");
    expect(delivered.translations).toEqual({});

    english.socket.close(1000, "done");
    spanish.socket.close(1000, "done");
  });

  it("closes an oversize message and drops an empty one", async () => {
    const path = await createRoom();
    const empty = await join(path, "en");
    const peer = await join(path, "es");

    empty.socket.send(JSON.stringify({ type: "chat", text: "   ", cid: 3 }));
    empty.socket.send(JSON.stringify({ type: "chat", text: "after the blank", cid: 4 }));
    const delivered = await peer.next("chat");
    // The blank message was dropped, not delivered and not fatal: the very next
    // message on the same socket arrives normally.
    expect(delivered.original).toBe("after the blank");
    expect(delivered.seq).toBe(1_000_004);
    empty.socket.close(1000, "done");
    peer.socket.close(1000, "done");

    // Validation of malformed senders gets an isolated room. The product
    // contract never admits a third joined participant just for a test case.
    const oversizePath = await createRoom();
    const oversize = await join(oversizePath, "en");
    oversize.socket.send(JSON.stringify({
      type: "chat", text: "x".repeat(201), cid: 5
    }));
    expect((await oversize.closed).code).toBe(1008);

    const badCidPath = await createRoom();
    const badCid = await join(badCidPath, "en");
    badCid.socket.send(JSON.stringify({ type: "chat", text: "hi", cid: 1_000_000 }));
    expect((await badCid.closed).code).toBe(1008);
  });

  it("closes a socket that floods the room past the per-minute limit", async () => {
    const path = await createRoom();
    // Single language on purpose: the limit is what is under test, not Modal.
    const flooder = await join(path, "en");
    const peer = await join(path, "en");

    for (let cid = 0; cid < 60; cid++) {
      flooder.socket.send(JSON.stringify({ type: "chat", text: `m${cid}`, cid }));
      expect((await peer.next("chat")).seq).toBe(1_000_000 + cid);
    }
    flooder.socket.send(JSON.stringify({ type: "chat", text: "one too many", cid: 60 }));
    expect((await flooder.closed).code).toBe(1008);

    peer.socket.close(1000, "done");
  });

  it("still closes a browser that authors a caption", async () => {
    const path = await createRoom();
    const forger = await join(path, "en");
    forger.socket.send(JSON.stringify({
      type: "caption", speaker: "forged", final: true, original: "injected",
      translations: {}, seq: 1
    }));
    expect((await forger.closed).code).toBe(1008);
  });
});

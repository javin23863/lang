import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SECRET = "test-only-room-signing-key-32-bytes";

type CreatedRoom = {
  path: string;
  host_control: string;
  expires_at: number;
};

type SocketClient = {
  socket: WebSocket;
  next: () => Promise<Record<string, unknown>>;
};

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signedHostControl(roomId: string, expiresAt: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const payload = `host-control.v1.${roomId}.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `hc1.${roomId}.${expiresAt}.${base64url(signature)}`;
}

async function createRoom(): Promise<CreatedRoom> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST", headers: { Origin: ORIGIN }
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  return response.json<CreatedRoom>();
}

function controlHeaders(token: string, origin = ORIGIN): HeadersInit {
  return { Origin: origin, Authorization: `Bearer ${token}` };
}

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
  socket.addEventListener("message", event => {
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

async function join(client: SocketClient): Promise<Record<string, unknown>> {
  client.socket.send(JSON.stringify({
    type: "join", locale: "en-US", name: "Host test", voice_profile: "en-us-af-heart"
  }));
  return client.next();
}

function nonCanonicalSignatureAlias(token: string): string {
  const last = token.at(-1)!;
  const index = BASE64URL_ALPHABET.indexOf(last);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(index % 4).toBe(0);
  return `${token.slice(0, -1)}${BASE64URL_ALPHABET[index + 1]}`;
}

describe("host room-control interface", () => {
  it("mints a distinct, room-bound host bearer and rejects forgery, participant bearers, cross-origin use, and expiry", async () => {
    const created = await createRoom();
    const participantToken = created.path.split("/").pop()!;
    const [, roomId, expiresRaw, signature] = created.host_control.split(".");
    expect(created.path).toMatch(/^\/room\/[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(created.host_control).toMatch(/^hc1\.[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(created.host_control).not.toContain(participantToken);
    expect(roomId).toBe(participantToken.split(".")[0]);
    expect(Number(expiresRaw)).toBe(created.expires_at);

    const ready = await exports.default.fetch(`${ORIGIN}/api/room-control`, {
      headers: controlHeaders(created.host_control)
    });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ state: "ready", participant_count: 0 });
    expect(ready.headers.get("Cache-Control")).toBe("no-store");
    expect(ready.headers.get("Referrer-Policy")).toBe("no-referrer");

    const forgedSignature = `${created.host_control.slice(0, -signature.length)}`
      + `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const expired = await signedHostControl(roomId, Math.floor(Date.now() / 1000) - 1);
    for (const [token, origin] of [
      [participantToken, ORIGIN],
      [forgedSignature, ORIGIN],
      [nonCanonicalSignatureAlias(created.host_control), ORIGIN],
      [expired, ORIGIN],
      [created.host_control, "https://attacker.test"]
    ]) {
      expect((await exports.default.fetch(`${ORIGIN}/api/room-control`, {
        headers: controlHeaders(token, origin)
      })).status).toBe(403);
    }
  });

  it("reports open presence, terminally closes current sockets, and preserves a revocation tombstone through the participant interface", async () => {
    const created = await createRoom();
    const client = await openSocket(created.path);
    expect(await join(client)).toMatchObject({ type: "welcome" });

    const open = await exports.default.fetch(`${ORIGIN}/api/room-control`, {
      headers: controlHeaders(created.host_control)
    });
    expect(await open.json()).toMatchObject({ state: "open", participant_count: 1 });

    const closed = new Promise<CloseEvent>(resolve => client.socket.addEventListener("close", resolve));
    const response = await exports.default.fetch(`${ORIGIN}/api/room-control/close`, {
      method: "POST", headers: controlHeaders(created.host_control)
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "closed", participant_count: 0 });
    expect(await client.next()).toMatchObject({ type: "room_closed" });
    expect((await closed)).toMatchObject({ code: 4001, reason: "room closed" });

    const token = created.path.split("/").pop()!;
    expect((await exports.default.fetch(`${ORIGIN}${created.path}`)).status).toBe(404);
    expect((await exports.default.fetch(`${ORIGIN}/api/room`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors"
      }
    })).status).toBe(410);
    expect((await exports.default.fetch(`${ORIGIN}/ws/${token}`, {
      headers: { Origin: ORIGIN, Upgrade: "websocket" }
    })).status).toBe(410);

    const roomId = token.split(".")[0];
    const storage = await runInDurableObject(env.ROOMS.getByName(roomId), async (_instance, ctx) =>
      [...(await ctx.storage.list()).keys()]
    );
    expect(storage).toEqual(expect.arrayContaining(["expiresAt", "closedAt"]));
  });

  it("never revokes another room and requires a same-origin close", async () => {
    const a = await createRoom();
    const b = await createRoom();
    expect((await exports.default.fetch(`${ORIGIN}/api/room-control/close`, {
      method: "POST", headers: controlHeaders(a.host_control, "https://attacker.test")
    })).status).toBe(403);
    expect((await exports.default.fetch(`${ORIGIN}/api/room-control/close`, {
      method: "POST", headers: controlHeaders(a.host_control)
    })).status).toBe(200);

    expect((await exports.default.fetch(`${ORIGIN}${b.path}`)).status).toBe(200);
    const status = await exports.default.fetch(`${ORIGIN}/api/room-control`, {
      headers: controlHeaders(b.host_control)
    });
    expect(await status.json()).toMatchObject({ state: "ready", participant_count: 0 });
  });
});

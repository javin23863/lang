import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";
const MESSAGE_TIMEOUT_MS = 1_500;

type CreatedRoom = {path: string; host_control: string; expires_at: number};
type Client = {socket: WebSocket; next: () => Promise<Record<string, unknown>>};

async function openSocket(path: string): Promise<Client> {
  const response = await exports.default.fetch(`${ORIGIN}${path.replace("/room/", "/ws/")}`, {
    headers: {Origin: ORIGIN, Upgrade: "websocket"},
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const queued: Record<string, unknown>[] = [];
  const readers: Array<(value: Record<string, unknown>) => void> = [];
  socket.addEventListener("message", event => {
    const value = JSON.parse(String(event.data)) as Record<string, unknown>;
    const reader = readers.shift();
    if (reader) reader(value); else queued.push(value);
  });
  return {
    socket,
    next: () => queued.length
      ? Promise.resolve(queued.shift()!)
      : new Promise(resolve => readers.push(resolve)),
  };
}

function nextWithTimeout(client: Client, expected: string): Promise<Record<string, unknown>> {
  return Promise.race([
    client.next(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out waiting for ${expected}`)), MESSAGE_TIMEOUT_MS);
    }),
  ]);
}

async function nextOfType(client: Client, type: string, limit = 12): Promise<Record<string, unknown>> {
  for (let index = 0; index < limit; index++) {
    const message = await nextWithTimeout(client, type);
    if (message.type === type) return message;
  }
  throw new Error(`did not receive ${type} within ${limit} messages`);
}

function join(client: Client, locale: string): Promise<Record<string, unknown>> {
  client.socket.send(JSON.stringify({
    type: "join",
    locale,
    name: locale,
    voice_profile: locale === "es-ES" ? "es-es-elvira" : "en-us-af-heart",
  }));
  return nextOfType(client, "welcome");
}

describe("prelaunch host-to-guest journey", () => {
  it("creates a private room, serves the guest surface, admits exactly two participants, and closes the invite", async () => {
    const create = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: await hostSessionCookie("PrelaunchJourneyHost01")},
    });
    expect(create.status).toBe(201);
    expect(create.headers.get("Cache-Control")).toBe("no-store");
    const room = await create.json<CreatedRoom>();
    expect(room.path).toMatch(/^\/room\/[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(room.host_control).toMatch(/^hc1\.[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}$/);

    const guestSurface = await exports.default.fetch(`${ORIGIN}${room.path}`);
    expect(guestSurface.status).toBe(200);
    expect(guestSurface.headers.get("Referrer-Policy")).toBe("no-referrer");
    const html = await guestSurface.text();
    expect(html).toContain('id="roleGate"');
    expect(html).toContain('id="termsAgree" type="checkbox"');
    expect(html).not.toContain('id="termsAgree" type="checkbox" checked');

    const host = await openSocket(room.path);
    expect(await join(host, "en-US")).toMatchObject({
      type: "welcome",
      participant_limit: 2,
      participant_count: 1,
    });

    const guest = await openSocket(room.path);
    expect(await join(guest, "es-ES")).toMatchObject({
      type: "welcome",
      participant_limit: 2,
      participant_count: 2,
    });
    expect(await nextOfType(host, "peer_join")).toMatchObject({type: "peer_join", participant_count: 2});

    const third = await openSocket(room.path);
    third.socket.send(JSON.stringify({
      type: "join", locale: "fr-FR", name: "fr-FR", voice_profile: null,
    }));
    expect(await nextOfType(third, "room_full")).toMatchObject({
      type: "room_full", limit: 2, participant_count: 2,
    });

    const close = await exports.default.fetch(`${ORIGIN}/api/room-control/close`, {
      method: "POST",
      headers: {Origin: ORIGIN, Authorization: `Bearer ${room.host_control}`},
    });
    expect(close.status).toBe(200);
    expect(await close.json()).toMatchObject({state: "closed", participant_count: 0});
    expect(await nextOfType(host, "room_closed")).toMatchObject({type: "room_closed"});
    expect(await nextOfType(guest, "room_closed")).toMatchObject({type: "room_closed"});
    expect((await exports.default.fetch(`${ORIGIN}${room.path}`)).status).toBe(404);
  });
});

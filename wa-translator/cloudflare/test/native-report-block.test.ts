import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";
const NATIVE_ORIGIN = "capacitor://localhost";

async function createRoom(): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: {Origin: ORIGIN, Cookie: await hostSessionCookie()},
  });
  expect(response.status).toBe(201);
  return (await response.json<{path: string}>()).path.split("/").pop()!;
}

async function join(room: string): Promise<{id: string; socket: WebSocket}> {
  const response = await exports.default.fetch(`${ORIGIN}/ws/${room}`, {
    headers: {Origin: ORIGIN, Upgrade: "websocket"},
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const welcome = new Promise<Record<string, unknown>>(resolve =>
    socket.addEventListener("message", event => resolve(JSON.parse(String(event.data))), {once: true}));
  socket.send(JSON.stringify({
    type: "join", locale: "en-US", name: "Reporter", voice_profile: "en-us-af-heart",
  }));
  return {id: String((await welcome).id), socket};
}

describe("native report blocking", () => {
  it("durably accepts a native report and immediately closes that private room", async () => {
    const room = await createRoom();
    const participant = await join(room);

    const reported = await exports.default.fetch(`${ORIGIN}/api/v1/reports`, {
      method: "POST",
      headers: {
        Origin: NATIVE_ORIGIN,
        Authorization: `Bearer ${room}`,
        "X-Participant-ID": participant.id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({category: "harassment", platform: "native"}),
    });
    expect(reported.status).toBe(201);
    expect(await reported.json()).toEqual({status: "received"});

    const closed = await exports.default.fetch(`${ORIGIN}/api/room`, {
      headers: {Origin: ORIGIN, Authorization: `Bearer ${room}`},
    });
    expect(closed.status).toBe(410);
    participant.socket.close(1000, "done");
  });
});

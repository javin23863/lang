import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";

async function createRoom(ip?: string): Promise<string> {
  const headers: Record<string, string> = { Origin: ORIGIN, Cookie: await hostSessionCookie() };
  if (ip) headers["CF-Connecting-IP"] = ip;
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST", headers
  });
  expect(response.status).toBe(201);
  return (await response.json<{path: string}>()).path.split("/").pop()!;
}

async function join(room: string): Promise<{id: string; socket: WebSocket}> {
  const response = await exports.default.fetch(`${ORIGIN}/ws/${room}`, {
    headers: { Origin: ORIGIN, Upgrade: "websocket" }
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const welcome = new Promise<Record<string, unknown>>(resolve =>
    socket.addEventListener("message", event => resolve(JSON.parse(String(event.data))), {once: true}));
  socket.send(JSON.stringify({
    type: "join", locale: "en-US", name: "Reporter", voice_profile: "en-us-af-heart"
  }));
  return {id: String((await welcome).id), socket};
}

describe("free-tier abuse controls and private reports", () => {
  it("rate limits room creation by Cloudflare client IP", async () => {
    const ip = "203.0.113.51";
    for (let index = 0; index < 12; index++) await createRoom(ip);
    const limited = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, "CF-Connecting-IP": ip, Cookie: await hostSessionCookie()}
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("rate limits TURN credentials per room and across rooms by client IP", async () => {
    const room = await createRoom();
    const requestTurn = (token: string, ip?: string) => {
      const headers: Record<string, string> = {
        Origin: ORIGIN, Authorization: `Bearer ${token}`
      };
      if (ip) headers["CF-Connecting-IP"] = ip;
      return exports.default.fetch(`${ORIGIN}/api/turn`, {headers});
    };
    for (let index = 0; index < 12; index++) {
      expect((await requestTurn(room)).status).toBe(200);
    }
    const roomLimited = await requestTurn(room);
    expect(roomLimited.status).toBe(429);
    expect(Number(roomLimited.headers.get("Retry-After"))).toBeGreaterThan(0);

    const ip = "203.0.113.52";
    const rooms = await Promise.all([createRoom(), createRoom(), createRoom(), createRoom(), createRoom()]);
    for (let count = 0; count < 48; count++) {
      expect((await requestTurn(rooms[Math.floor(count / 12)], ip)).status).toBe(200);
    }
    expect((await requestTurn(rooms[4], ip)).status).toBe(429);
  });

  it("deletes expired per-IP quota state by alarm", async () => {
    const gate = env.ABUSE.getByName("alarm-test");
    expect((await gate.fetch("https://abuse.internal/consume", {
      method: "POST",
      headers: {"X-Quota-Limit": "1", "X-Quota-Window-Ms": "1000"}
    })).status).toBe(204);
    expect(await runInDurableObject(gate, async (_instance, ctx) =>
      ctx.storage.getAlarm())).not.toBeNull();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 2000);
      await runDurableObjectAlarm(gate);
      expect(await runInDurableObject(gate, async (_instance, ctx) =>
        (await ctx.storage.list()).size)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts one private category-only report from a live participant", async () => {
    const room = await createRoom();
    const participant = await join(room);
    const headers = {
      Origin: ORIGIN,
      Authorization: `Bearer ${room}`,
      "X-Participant-ID": participant.id,
      "Content-Type": "application/json",
    };
    const accepted = await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST", headers,
      body: JSON.stringify({category: "harassment", platform: "android"})
    });
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toEqual({status: "received"});
    expect(accepted.headers.get("Cache-Control")).toBe("no-store");

    const duplicate = await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST", headers,
      body: JSON.stringify({category: "harassment", platform: "android"})
    });
    expect(duplicate.status).toBe(409);

    const denied = await exports.default.fetch(`${ORIGIN}/api/internal/reports`, {
      headers: {Authorization: "Bearer wrong"}
    });
    expect(denied.status).toBe(403);
    const inbox = await exports.default.fetch(`${ORIGIN}/api/internal/reports`, {
      headers: {Authorization: "Bearer test-only-report-admin-token-32-bytes"}
    });
    expect(inbox.status).toBe(200);
    const body = await inbox.json<{reports: Record<string, unknown>[]}>();
    expect(body.reports).toEqual(expect.arrayContaining([
      expect.objectContaining({category: "harassment", platform: "android"})
    ]));
    expect(JSON.stringify(body)).not.toContain(room);
    expect(JSON.stringify(body)).not.toContain(participant.id);
    participant.socket.close(1000, "done");
  });

  it("rejects unsupported, unauthenticated, and content-bearing reports", async () => {
    const room = await createRoom();
    const participant = await join(room);
    const base = {
      Origin: ORIGIN,
      Authorization: `Bearer ${room}`,
      "X-Participant-ID": participant.id,
      "Content-Type": "application/json",
    };
    for (const body of [
      {category: "not-a-category", platform: "web"},
      {category: "threat", platform: "web", details: "private transcript"},
    ]) {
      expect((await exports.default.fetch(`${ORIGIN}/api/reports`, {
        method: "POST", headers: base, body: JSON.stringify(body)
      })).status).toBe(422);
    }
    expect((await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST", headers: {Origin: ORIGIN, "Content-Type": "application/json"},
      body: JSON.stringify({category: "threat", platform: "web"})
    })).status).toBe(403);
    participant.socket.close(1000, "done");
  });

  it("rolls back a reservation when the private inbox write fails", async () => {
    const room = await createRoom();
    const participant = await join(room);
    const headers = {
      Origin: ORIGIN, Authorization: `Bearer ${room}`,
      "X-Participant-ID": participant.id, "Content-Type": "application/json",
      "X-Test-Report-Failure": "1",
    };
    const failed = await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST", headers,
      body: JSON.stringify({category: "scam", platform: "web"})
    });
    expect(failed.status).toBe(503);
    delete (headers as Record<string, string>)["X-Test-Report-Failure"];
    expect((await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST", headers,
      body: JSON.stringify({category: "scam", platform: "web"})
    })).status).toBe(201);
    participant.socket.close(1000, "done");
  });

  it("caps reconnect report spam persistently within one room", async () => {
    const room = await createRoom();
    for (let count = 0; count < 8; count++) {
      const participant = await join(room);
      const response = await exports.default.fetch(`${ORIGIN}/api/reports`, {
        method: "POST",
        headers: {
          Origin: ORIGIN, Authorization: `Bearer ${room}`,
          "X-Participant-ID": participant.id, "Content-Type": "application/json",
        },
        body: JSON.stringify({category: "other", platform: "web"})
      });
      expect(response.status).toBe(201);
      participant.socket.close(1000, "reconnect");
    }
    const ninth = await join(room);
    expect((await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST",
      headers: {
        Origin: ORIGIN, Authorization: `Bearer ${room}`,
        "X-Participant-ID": ninth.id, "Content-Type": "application/json",
      },
      body: JSON.stringify({category: "other", platform: "web"})
    })).status).toBe(429);
    ninth.socket.close(1000, "done");
  });

  it("caps reports across rooms by Cloudflare client IP", async () => {
    const ip = "203.0.113.53";
    for (let count = 0; count < 13; count++) {
      const room = await createRoom();
      const participant = await join(room);
      const response = await exports.default.fetch(`${ORIGIN}/api/reports`, {
        method: "POST",
        headers: {
          Origin: ORIGIN, Authorization: `Bearer ${room}`,
          "X-Participant-ID": participant.id, "Content-Type": "application/json",
          "CF-Connecting-IP": ip,
        },
        body: JSON.stringify({category: "other", platform: "web"})
      });
      expect(response.status).toBe(count < 12 ? 201 : 429);
      participant.socket.close(1000, "done");
    }
  });

  it("does not let forged participant IDs consume the shared report quota", async () => {
    const ip = "203.0.113.54";
    const room = await createRoom();
    const participant = await join(room);
    for (let count = 0; count < 12; count++) {
      expect((await exports.default.fetch(`${ORIGIN}/api/reports`, {
        method: "POST",
        headers: {
          Origin: ORIGIN, Authorization: `Bearer ${room}`,
          "X-Participant-ID": String(count).padStart(16, "0"),
          "Content-Type": "application/json", "CF-Connecting-IP": ip,
        },
        body: JSON.stringify({category: "other", platform: "web"})
      })).status).toBe(403);
    }
    expect((await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST",
      headers: {
        Origin: ORIGIN, Authorization: `Bearer ${room}`,
        "X-Participant-ID": participant.id,
        "Content-Type": "application/json", "CF-Connecting-IP": ip,
      },
      body: JSON.stringify({category: "other", platform: "web"})
    })).status).toBe(201);
    participant.socket.close(1000, "done");
  });

  it("stores a retried internal submission only once", async () => {
    const inbox = env.REPORTS.getByName("idempotent");
    const body = JSON.stringify({
      category: "scam", platform: "web", room_ref: "abcdefghijklmnop",
      submission_id: "abcdefghijklmnopqrstuv", room_id: "abcdefghijklmnopqrstuvwx",
      room_expires: Math.floor(Date.now() / 1000) + 3600,
    });
    expect((await inbox.fetch("https://reports.internal/", {
      method: "POST", headers: {"Content-Type": "application/json"}, body
    })).status).toBeLessThan(300);
    await runInDurableObject(inbox, async (_instance, ctx) => ctx.storage.deleteAlarm());
    expect((await inbox.fetch("https://reports.internal/", {
      method: "POST", headers: {"Content-Type": "application/json"}, body
    })).status).toBeLessThan(300);
    const state = await runInDurableObject(inbox, async (_instance, ctx) => ({
      count: (await ctx.storage.list({prefix: "report:"})).size,
      alarm: await ctx.storage.getAlarm(),
    }));
    expect(state.count).toBe(1);
    expect(state.alarm).not.toBeNull();
  });

  it("lets only the private moderator close the room named by a report", async () => {
    const room = await createRoom();
    const participant = await join(room);
    expect((await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST",
      headers: {
        Origin: ORIGIN, Authorization: `Bearer ${room}`,
        "X-Participant-ID": participant.id, "Content-Type": "application/json",
      },
      body: JSON.stringify({category: "sexual", platform: "ios"})
    })).status).toBe(201);
    const inbox = await exports.default.fetch(`${ORIGIN}/api/internal/reports`, {
      headers: {Authorization: "Bearer test-only-report-admin-token-32-bytes"}
    });
    const reports = (await inbox.json<{reports: {id: string; category: string}[]}>()).reports;
    const report = reports.find(item => item.category === "sexual")!;
    expect(report.id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    expect((await exports.default.fetch(
      `${ORIGIN}/api/internal/reports/${report.id}/close`, {method: "POST"}
    )).status).toBe(403);
    const closed = await exports.default.fetch(
      `${ORIGIN}/api/internal/reports/${report.id}/close`, {
        method: "POST",
        headers: {Authorization: "Bearer test-only-report-admin-token-32-bytes"}
      }
    );
    expect(closed.status).toBe(200);
    expect(await closed.json()).toEqual({state: "closed"});
    expect((await exports.default.fetch(`${ORIGIN}/api/room`, {
      headers: {Origin: ORIGIN, Authorization: `Bearer ${room}`}
    })).status).toBe(410);
  });

  it("deletes retained reports by alarm without waiting for later traffic", async () => {
    const room = await createRoom();
    const participant = await join(room);
    expect((await exports.default.fetch(`${ORIGIN}/api/reports`, {
      method: "POST",
      headers: {
        Origin: ORIGIN, Authorization: `Bearer ${room}`,
        "X-Participant-ID": participant.id, "Content-Type": "application/json",
      },
      body: JSON.stringify({category: "hate", platform: "ios"})
    })).status).toBe(201);
    const inbox = env.REPORTS.getByName("global");
    expect((await runInDurableObject(inbox, async (_instance, ctx) => ({
      count: (await ctx.storage.list({prefix: "report:"})).size,
      alarm: await ctx.storage.getAlarm(),
    }))).alarm).not.toBeNull();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
      await runDurableObjectAlarm(inbox);
      expect(await runInDurableObject(inbox, async (_instance, ctx) =>
        (await ctx.storage.list({prefix: "report:"})).size)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    participant.socket.close(1000, "done");
  });
});

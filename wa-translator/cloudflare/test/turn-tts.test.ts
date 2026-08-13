import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

async function token(): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST", headers: { Origin: ORIGIN }
  });
  return (await response.json<{ path: string }>()).path.split("/").pop()!;
}

function auth(roomToken: string, origin = ORIGIN): HeadersInit {
  return { Origin: origin, Authorization: `Bearer ${roomToken}` };
}

async function join(roomToken: string): Promise<{ id: string; socket: WebSocket }> {
  const response = await exports.default.fetch(`${ORIGIN}/ws/${roomToken}`, {
    headers: { Origin: ORIGIN, Upgrade: "websocket" }
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const welcome = new Promise<any>(resolve => socket.addEventListener("message", event =>
    resolve(JSON.parse(String(event.data))), { once: true }));
  socket.send(JSON.stringify({
    type: "join", lang: "en", name: "listener", voice_style: "female"
  }));
  return { id: (await welcome).id, socket };
}

function voiceHeaders(roomToken: string, participantId: string): HeadersInit {
  return {
    ...auth(roomToken),
    "X-Participant-ID": participantId,
    "Content-Type": "application/json"
  };
}

describe("TURN and translated-voice edge interfaces", () => {
  it("returns short-lived dynamic ICE config without exposing the long-term key", async () => {
    const roomToken = await token();
    const response = await exports.default.fetch(`${ORIGIN}/api/turn`, {
      headers: auth(roomToken)
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json<any>();
    expect(body.iceServers).toEqual(expect.arrayContaining([
      expect.objectContaining({ username: "short-lived-user", credential: "short-lived-credential" })
    ]));
    expect(body.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(3598);
    expect(JSON.stringify(body)).not.toContain("test-only-turn-token");

    // Browsers do not attach Origin to a same-origin GET. Fetch Metadata is a
    // forbidden request header, so a cross-origin page cannot forge this path.
    const browserGet = await exports.default.fetch(`${ORIGIN}/api/turn`, {
      headers: {
        Authorization: `Bearer ${roomToken}`,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors"
      }
    });
    expect(browserGet.status).toBe(200);

    for (const headers of [
      { Origin: ORIGIN },
      { Authorization: `Bearer ${roomToken}` },
      { Authorization: `Bearer ${roomToken}`, "Sec-Fetch-Site": "cross-site" },
      auth(roomToken, "https://attacker.test"),
      auth(roomToken.slice(0, -1) + "A")
    ]) {
      expect((await exports.default.fetch(`${ORIGIN}/api/turn`, { headers })).status).toBe(403);
    }
  });

  it("routes four controlled voices to authenticated Modal HTTP and enforces caps", async () => {
    const roomToken = await token();
    const participant = await join(roomToken);
    for (const lang of ["en", "es"] as const) {
      for (const voice_style of ["female", "male"] as const) {
        const response = await exports.default.fetch(`${ORIGIN}/tts`, {
          method: "POST",
          headers: voiceHeaders(roomToken, participant.id),
          body: JSON.stringify({ text: "hello", lang, voice_style })
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("audio/wav");
        expect(response.headers.get("X-Upstream-Secret")).toBeNull();
        expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBeGreaterThan(4);
      }
    }

    const invalid = [
      { text: "hello", lang: "fr", voice_style: "female" },
      { text: "hello", lang: "en", voice_style: "match" },
      { text: "x".repeat(301), lang: "en", voice_style: "male" }
    ];
    for (const body of invalid) {
      const response = await exports.default.fetch(`${ORIGIN}/tts`, {
        method: "POST",
        headers: voiceHeaders(roomToken, participant.id),
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(422);
    }
    const oversized = await exports.default.fetch(`${ORIGIN}/tts`, {
      method: "POST",
      headers: voiceHeaders(roomToken, participant.id),
      body: JSON.stringify({ text: "x".repeat(3000), lang: "en", voice_style: "female" })
    });
    expect(oversized.status).toBe(413);
    participant.socket.close(1000, "done");
  });

  it("requires a live participant and caps translated voice per room", async () => {
    const roomToken = await token();
    const participant = await join(roomToken);
    const body = JSON.stringify({ text: "hello", lang: "en", voice_style: "female" });
    const missingParticipant = await exports.default.fetch(`${ORIGIN}/tts`, {
      method: "POST",
      headers: { ...auth(roomToken), "Content-Type": "application/json" },
      body
    });
    expect(missingParticipant.status).toBe(403);
    for (let count = 0; count < 12; count++) {
      const response = await exports.default.fetch(`${ORIGIN}/tts`, {
        method: "POST", headers: voiceHeaders(roomToken, participant.id), body
      });
      expect(response.status).toBe(200);
    }
    const limited = await exports.default.fetch(`${ORIGIN}/tts`, {
      method: "POST", headers: voiceHeaders(roomToken, participant.id), body
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);

    const otherToken = await token();
    const other = await join(otherToken);
    expect((await exports.default.fetch(`${ORIGIN}/tts`, {
      method: "POST", headers: voiceHeaders(otherToken, other.id), body
    })).status).toBe(200);
    participant.socket.close(1000, "done");
    other.socket.close(1000, "done");
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

async function token(): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST", headers: { Origin: ORIGIN }
  });
  return (await response.json<{ path: string }>()).path.split("/").pop()!;
}

function auth(roomToken: string, origin = ORIGIN): HeadersInit {
  return { Origin: origin, Authorization: `Bearer ${roomToken}` };
}

function nonCanonicalSignatureAlias(token: string): string {
  const last = token.at(-1)!;
  const index = BASE64URL_ALPHABET.indexOf(last);
  // A 32-byte HMAC encodes to 43 Base64URL characters. Its final two bits
  // are padding, so this produces different text which decodes to the same
  // bytes unless the verifier requires a canonical representation.
  expect(index).toBeGreaterThanOrEqual(0);
  expect(index % 4).toBe(0);
  return `${token.slice(0, -1)}${BASE64URL_ALPHABET[index + 1]}`;
}

async function join(
  roomToken: string, locale = "en-US", voice_profile = "en-us-af-heart",
): Promise<{ id: string; socket: WebSocket }> {
  const response = await exports.default.fetch(`${ORIGIN}/ws/${roomToken}`, {
    headers: { Origin: ORIGIN, Upgrade: "websocket" }
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const welcome = new Promise<any>(resolve => socket.addEventListener("message", event =>
    resolve(JSON.parse(String(event.data))), { once: true }));
  socket.send(JSON.stringify({
    type: "join", locale, name: "listener", voice_profile
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
      auth(nonCanonicalSignatureAlias(roomToken))
    ]) {
      expect((await exports.default.fetch(`${ORIGIN}/api/turn`, { headers })).status).toBe(403);
    }
  });

  it("routes only each participant's explicitly selected profile to Modal and enforces caps", async () => {
    const roomToken = await token();
    const participants = await Promise.all([
      join(roomToken, "en-US", "en-us-af-heart"),
      join(roomToken, "en-US", "en-us-am-michael"),
      join(roomToken, "es-ES", "es-ef-dora"),
      join(roomToken, "es-ES", "es-em-alex"),
    ]);
    for (const [participant, [locale, voice_profile]] of participants.map((participant, index) => [
      participant,
      [["en-US", "en-us-af-heart"], ["en-US", "en-us-am-michael"],
       ["es-ES", "es-ef-dora"], ["es-ES", "es-em-alex"]][index],
    ] as const)) {
      const response = await exports.default.fetch(`${ORIGIN}/tts`, {
        method: "POST", headers: voiceHeaders(roomToken, participant.id),
        body: JSON.stringify({ text: "hello", locale, voice_profile })
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("audio/wav");
      expect(response.headers.get("X-Upstream-Secret")).toBeNull();
      expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBeGreaterThan(4);
    }

    const invalid = [
      { text: "hello", locale: "ar-SA", voice_profile: null },
      { text: "hello", locale: "en-US", voice_profile: "es-em-alex" },
      { text: "x".repeat(301), locale: "en-US", voice_profile: "en-us-am-michael" }
    ];
    for (const body of invalid) {
      const response = await exports.default.fetch(`${ORIGIN}/tts`, {
        method: "POST",
        headers: voiceHeaders(roomToken, participants[0].id),
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(422);
    }
    const wrongSelectedProfile = await exports.default.fetch(`${ORIGIN}/tts`, {
      method: "POST", headers: voiceHeaders(roomToken, participants[0].id),
      body: JSON.stringify({ text: "hello", locale: "en-US", voice_profile: "en-us-am-michael" })
    });
    expect(wrongSelectedProfile.status).toBe(403);
    const oversized = await exports.default.fetch(`${ORIGIN}/tts`, {
      method: "POST",
      headers: voiceHeaders(roomToken, participants[0].id),
      body: JSON.stringify({ text: "x".repeat(3000), locale: "en-US", voice_profile: "en-us-af-heart" })
    });
    expect(oversized.status).toBe(413);
    for (const participant of participants) participant.socket.close(1000, "done");
  });

  it("fails closed on missing, oversized, non-RIFF, and truncated upstream audio", async () => {
    const roomToken = await token();
    const participant = await join(roomToken);
    const request = (text: string) => exports.default.fetch(`${ORIGIN}/tts`, {
      method: "POST",
      headers: voiceHeaders(roomToken, participant.id),
      body: JSON.stringify({ text, locale: "en-US", voice_profile: "en-us-af-heart" })
    });

    for (const text of [
      "fixture-missing-length", "fixture-oversize-length", "fixture-non-riff"
    ]) {
      expect((await request(text)).status, text).toBe(503);
    }
    const truncated = await request("fixture-truncated");
    await expect(truncated.arrayBuffer()).rejects.toThrow();
    participant.socket.close(1000, "done");
  });

  it("requires a live participant and caps translated voice per room", async () => {
    const roomToken = await token();
    const participant = await join(roomToken);
    const body = JSON.stringify({
      text: "hello", locale: "en-US", voice_profile: "en-us-af-heart"
    });
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

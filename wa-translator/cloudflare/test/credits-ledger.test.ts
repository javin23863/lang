import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

type Snapshot = {
  signed_in: boolean;
  credits?: { balance: number };
  totals?: { call_minutes: number; chat_messages: number; tts_phrases: number };
  recent?: Array<{ at: string; kind: string; units: number; room_ref: string }>;
};

type Participant = { id: string; socket: WebSocket };

// Each test signs in as its own provider identity, so no test can inherit a
// balance, a total, or a usage row from the one before it.
async function signIn(code = "fixture-google"): Promise<string> {
  const started = await exports.default.fetch(`${ORIGIN}/auth/google/start`, {
    redirect: "manual"
  });
  const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
  const callback = await exports.default.fetch(
    `${ORIGIN}/auth/google/callback?code=${code}&state=${encodeURIComponent(state)}`,
    {
      headers: {
        Cookie: started.headers.getSetCookie().map(value => value.split(";")[0]).join("; ")
      },
      redirect: "manual"
    }
  );
  const session = callback.headers.getSetCookie()
    .find(value => value.startsWith("lr_s="))!.split(";")[0];
  expect(session).toBeTruthy();
  return session;
}

async function createRoom(session: string): Promise<{ token: string; hostControl: string }> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST", headers: { Origin: ORIGIN, Cookie: session }
  });
  expect(response.status).toBe(201);
  const created = await response.json<{ path: string; host_control: string }>();
  return { token: created.path.split("/").pop()!, hostControl: created.host_control };
}

async function join(
  token: string, locale: string, voiceProfile: string
): Promise<Participant> {
  const response = await exports.default.fetch(`${ORIGIN}/ws/${token}`, {
    headers: { Origin: ORIGIN, Upgrade: "websocket" }
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const welcome = new Promise<Record<string, unknown>>(resolve => {
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (message.type === "welcome") resolve(message);
    });
  });
  socket.send(JSON.stringify({
    type: "join", locale, name: "Speaker", voice_profile: voiceProfile
  }));
  return { id: String((await welcome).id), socket };
}

async function speakTts(token: string, participant: Participant): Promise<void> {
  const response = await exports.default.fetch(`${ORIGIN}/tts`, {
    method: "POST",
    headers: {
      Origin: ORIGIN, Authorization: `Bearer ${token}`,
      "Content-Type": "application/json", "X-Participant-ID": participant.id
    },
    body: JSON.stringify({
      text: "hello", locale: "en-US", voice_profile: "en-us-af-heart"
    })
  });
  expect(response.status).toBe(200);
  await response.arrayBuffer();
}

// Wall-clock time inside one test is a few milliseconds. Rewinding the room's
// own clock is what makes "one call minute" a fact rather than a coin flip.
async function rewindCall(token: string, milliseconds: number): Promise<void> {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(token.split(".")[0]));
  await runInDurableObject(stub, async (_instance, ctx) => {
    const activeSince = await ctx.storage.get<number>("activeSince");
    expect(activeSince).toBeGreaterThan(0);
    await ctx.storage.put("activeSince", activeSince! - milliseconds);
  });
}

async function closeRoom(hostControl: string): Promise<void> {
  const response = await exports.default.fetch(`${ORIGIN}/api/room-control/close`, {
    method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${hostControl}` }
  });
  expect(response.status).toBe(200);
}

async function account(session: string): Promise<Snapshot> {
  const response = await exports.default.fetch(`${ORIGIN}/api/me`, {
    headers: { Cookie: session }
  });
  expect(response.status).toBe(200);
  return response.json<Snapshot>();
}

describe("credits balance and real usage metering", () => {
  it("meters a two-language call with translated voice back to the host account", async () => {
    const session = await signIn();
    const { token, hostControl } = await createRoom(session);
    const english = await join(token, "en-US", "en-us-af-heart");
    const spanish = await join(token, "es-ES", "es-ef-dora");
    await speakTts(token, english);
    await speakTts(token, english);
    await rewindCall(token, 90_000);

    english.socket.close(1000, "done");
    spanish.socket.close(1000, "done");
    await closeRoom(hostControl);

    const snapshot = await account(session);
    expect(snapshot.signed_in).toBe(true);
    expect(snapshot.totals!.tts_phrases).toBe(2);
    // 90 seconds of occupied room is one whole minute plus a part minute.
    expect(snapshot.totals!.call_minutes).toBeGreaterThanOrEqual(1);
    expect(snapshot.totals!.chat_messages).toBe(0);
    // No purchase path exists yet, so metering must not move the balance.
    expect(snapshot.credits).toEqual({ balance: 0 });

    const kinds = snapshot.recent!.map(row => row.kind).sort();
    expect(kinds).toEqual(["call", "tts"]);
    const serialized = JSON.stringify(snapshot.recent);
    for (const row of snapshot.recent!) {
      expect(row.room_ref).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(row.units).toBeGreaterThanOrEqual(1);
      expect(Date.parse(row.at)).toBeGreaterThan(0);
    }
    // The usage row is a count, not a way back into the room.
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(token.split(".")[0]);
    expect(serialized).not.toContain(hostControl);
  });

  it("drops a flush whose account was deleted mid-call instead of resurrecting it", async () => {
    const session = await signIn("fixture-google-second-account");
    const { token, hostControl } = await createRoom(session);
    const speaker = await join(token, "en-US", "en-us-af-heart");
    await speakTts(token, speaker);
    await rewindCall(token, 90_000);

    const deleted = await exports.default.fetch(`${ORIGIN}/api/account/delete`, {
      method: "POST", headers: { Origin: ORIGIN, Cookie: session }
    });
    expect(deleted.status).toBe(204);

    speaker.socket.close(1000, "done");
    await closeRoom(hostControl);

    // Same provider identity signs in again: a fresh, empty account. If the
    // dropped flush had upserted anything, these totals would carry it.
    const revived = await account(await signIn("fixture-google-second-account"));
    expect(revived.signed_in).toBe(true);
    expect(revived.totals).toEqual({
      call_minutes: 0, chat_messages: 0, tts_phrases: 0
    });
    expect(revived.recent).toEqual([]);
  });
});

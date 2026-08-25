import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSession } from "./session";

const USER_ID = "UsageIdemHost000000001";
const ROOM_REF = "abcdefghijklmnop";
const DELIVERY_ID = `u1.${ROOM_REF}.ABCDEFGHIJK.chat`;

async function accountStub() {
  await hostSession(USER_ID); // shared fixture also creates the matching profile
  return env.USERS.get(env.USERS.idFromName(USER_ID));
}

describe("idempotent account usage delivery", () => {
  it("counts one delivery exactly once even when the room retries it", async () => {
    const user = await accountStub();
    const body = JSON.stringify({
      kind: "chat", units: 3, room_ref: ROOM_REF, delivery_id: DELIVERY_ID,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await user.fetch("https://users.internal/usage", {
        method: "POST", headers: {"Content-Type": "application/json"}, body,
      });
      expect(response.status).toBe(204);
    }

    const response = await user.fetch("https://users.internal/");
    expect(response.status).toBe(200);
    const account = await response.json<{
      totals: {call_minutes: number; chat_messages: number; tts_phrases: number};
      recent: Array<{kind: string; units: number; room_ref: string}>;
    }>();
    expect(account.totals.chat_messages).toBe(3);
    expect(account.recent.filter(row => row.room_ref === ROOM_REF)).toEqual([
      expect.objectContaining({kind: "chat", units: 3, room_ref: ROOM_REF}),
    ]);
  });

  it("binds the delivery id to its room reference and usage kind", async () => {
    const user = await accountStub();
    for (const body of [
      {kind: "tts", units: 1, room_ref: ROOM_REF, delivery_id: DELIVERY_ID},
      {kind: "chat", units: 1, room_ref: "ponmlkjihgfedcba", delivery_id: DELIVERY_ID},
    ]) {
      const response = await user.fetch("https://users.internal/usage", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });
});

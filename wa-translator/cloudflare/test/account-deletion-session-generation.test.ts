import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionV2 } from "./session";

const ORIGIN = "https://room.test";
const USER_ID = "RecreateHostUser000001";

type Snapshot = {signed_in: boolean; providers: string[]};

function clearsSession(response: Response): boolean {
  return response.headers.getSetCookie().some(value =>
    value.startsWith("lr_s=") && value.includes("Max-Age=0")
  );
}

async function snapshot(session: string): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}/api/me`, {
    headers: {Cookie: `lr_s=${session}`},
  });
}

describe("account deletion session generation", () => {
  it("does not resurrect an old session when the same OAuth identity recreates its account", async () => {
    const oldSession = await hostSessionV2(USER_ID);
    expect((await (await snapshot(oldSession)).json<Snapshot>()).signed_in).toBe(true);

    const deleted = await exports.default.fetch(`${ORIGIN}/api/account/delete`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: `lr_s=${oldSession}`},
    });
    expect(deleted.status).toBe(204);
    expect(clearsSession(deleted)).toBe(true);

    const absent = await snapshot(oldSession);
    expect((await absent.clone().json<Snapshot>()).signed_in).toBe(false);
    expect(clearsSession(absent)).toBe(true);

    // The deterministic provider+subject account id is intentionally reused on
    // re-registration. The new s2 gets a post-delete issuance marker; the old
    // captured bearer does not, even though its HMAC and expiry remain valid.
    const freshSession = await hostSessionV2(USER_ID);
    expect(freshSession).not.toBe(oldSession);
    expect((await (await snapshot(freshSession)).json<Snapshot>()).signed_in).toBe(true);

    const resurrected = await snapshot(oldSession);
    expect((await resurrected.clone().json<Snapshot>()).signed_in).toBe(false);
    expect(clearsSession(resurrected)).toBe(true);

    const oldCreate = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: `lr_s=${oldSession}`},
    });
    expect(oldCreate.status).toBe(401);
    expect(clearsSession(oldCreate)).toBe(true);

    const freshCreate = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: `lr_s=${freshSession}`},
    });
    expect(freshCreate.status).toBe(201);
  });
});

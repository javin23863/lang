import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionV2 } from "./session";

const ORIGIN = "https://room.test";
const NATIVE_ORIGIN = "https://localhost";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

type Snapshot = {signed_in: boolean; providers: string[]};

function clearsSession(response: Response): boolean {
  return response.headers.getSetCookie().some(value =>
    value.startsWith("lr_s=") && value.includes("Max-Age=0")
  );
}

async function browserSnapshot(session: string): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}/api/me`, {
    headers: {Cookie: `lr_s=${session}`},
  });
}

describe("server-side session revocation", () => {
  it("revokes only the v2 browser session that logged out even when both expire together", async () => {
    const userId = "LogoutHostUser00000001";
    const first = await hostSessionV2(userId, SESSION_TTL_SECONDS);
    const second = await hostSessionV2(userId, SESSION_TTL_SECONDS);
    expect(first).toMatch(/^s2\./);
    expect(second).toMatch(/^s2\./);
    expect(first).not.toBe(second);
    expect(first.split(".")[2]).toBe(second.split(".")[2]);

    const foreign = await exports.default.fetch(`${ORIGIN}/auth/logout`, {
      method: "POST",
      headers: {Origin: "https://attacker.test", Cookie: `lr_s=${first}`},
    });
    expect(foreign.status).toBe(403);
    expect((await (await browserSnapshot(first)).json<Snapshot>()).signed_in).toBe(true);

    const logout = await exports.default.fetch(`${ORIGIN}/auth/logout`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: `lr_s=${first}`},
    });
    expect(logout.status).toBe(204);
    expect(clearsSession(logout)).toBe(true);

    const replay = await browserSnapshot(first);
    expect(replay.status).toBe(200);
    expect((await replay.clone().json<Snapshot>()).signed_in).toBe(false);
    expect(clearsSession(replay)).toBe(true);

    const blockedCreate = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: `lr_s=${first}`},
    });
    expect(blockedCreate.status).toBe(401);

    const blockedDelete = await exports.default.fetch(`${ORIGIN}/api/account/delete`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: `lr_s=${first}`},
    });
    expect(blockedDelete.status).toBe(401);

    const otherDevice = await browserSnapshot(second);
    expect(otherDevice.status).toBe(200);
    expect((await otherDevice.json<Snapshot>()).signed_in).toBe(true);
  });

  it("revokes a v2 native bearer and keeps the signed-out response readable by the app", async () => {
    const session = await hostSessionV2("NativeLogoutUser000001");
    const logout = await exports.default.fetch(`${ORIGIN}/api/v1/auth/logout`, {
      method: "POST",
      headers: {Origin: NATIVE_ORIGIN, Authorization: `Bearer ${session}`},
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);

    const account = await exports.default.fetch(`${ORIGIN}/api/v1/me`, {
      headers: {Origin: NATIVE_ORIGIN, Authorization: `Bearer ${session}`},
    });
    expect(account.status).toBe(200);
    expect(account.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect((await account.json<Snapshot>()).signed_in).toBe(false);

    const create = await exports.default.fetch(`${ORIGIN}/api/v1/rooms`, {
      method: "POST",
      headers: {Origin: NATIVE_ORIGIN, Authorization: `Bearer ${session}`},
    });
    expect(create.status).toBe(401);
    expect(create.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
  });
});

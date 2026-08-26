import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSession, hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";
const NATIVE_ORIGIN = "https://localhost";

type CreatedRoom = {path: string; host_control: string; expires_at: number};

async function deleteBrowserAccount(cookie: string): Promise<void> {
  const response = await exports.default.fetch(`${ORIGIN}/api/account/delete`, {
    method: "POST",
    headers: {Origin: ORIGIN, Cookie: cookie},
  });
  expect(response.status).toBe(204);
}

async function hostRoomState(control: string): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/room-control`, {
    headers: {Origin: ORIGIN, Authorization: `Bearer ${control}`},
  });
  expect(response.status).toBe(200);
  return (await response.json<{state: string}>()).state;
}

function clearsBrowserSession(response: Response): boolean {
  return response.headers.getSetCookie().some(value =>
    value.startsWith("lr_s=") && value.includes("Max-Age=0")
  );
}

describe("room creation requires a live account", () => {
  it("expires a stale browser session on account refresh after deletion", async () => {
    const cookie = await hostSessionCookie("DeletedHostUser0000001");
    await deleteBrowserAccount(cookie);

    const account = await exports.default.fetch(`${ORIGIN}/api/me`, {
      headers: {Cookie: cookie},
    });
    expect(account.status).toBe(200);
    expect(await account.clone().json()).toMatchObject({signed_in: false});
    expect(clearsBrowserSession(account)).toBe(true);
  });

  it("rejects room creation and expires a stale browser session after deletion", async () => {
    const cookie = await hostSessionCookie("DeletedHostUser0000003");
    await deleteBrowserAccount(cookie);

    const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: cookie},
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(clearsBrowserSession(response)).toBe(true);
  });

  it("rejects a stale native bearer with CORS so the app can self-clear it", async () => {
    const session = await hostSession("DeletedHostUser0000002");
    await deleteBrowserAccount(`lr_s=${session}`);

    const response = await exports.default.fetch(`${ORIGIN}/api/v1/rooms`, {
      method: "POST",
      headers: {Origin: NATIVE_ORIGIN, Authorization: `Bearer ${session}`},
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("closes account-owned rooms before account deletion succeeds", async () => {
    const cookie = await hostSessionCookie("DeleteOwnedRoomUser001");
    const createdResponse = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: cookie},
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<CreatedRoom>();
    expect(await hostRoomState(created.host_control)).toBe("ready");

    await deleteBrowserAccount(cookie);
    expect(await hostRoomState(created.host_control)).toBe("closed");
  });

  it("does not let a room escape a concurrent account deletion", async () => {
    const cookie = await hostSessionCookie("DeleteRoomRaceUser0001");
    const creation = exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: cookie},
    });
    const deletion = exports.default.fetch(`${ORIGIN}/api/account/delete`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: cookie},
    });

    const [createdResponse, deletedResponse] = await Promise.all([creation, deletion]);
    expect(deletedResponse.status).toBe(204);
    expect([201, 401, 409]).toContain(createdResponse.status);

    if (createdResponse.status === 201) {
      const created = await createdResponse.json<CreatedRoom>();
      expect(await hostRoomState(created.host_control)).toBe("closed");
    } else {
      expect(createdResponse.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("does not expose the retired HTML-form room creator", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: await hostSessionCookie()},
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

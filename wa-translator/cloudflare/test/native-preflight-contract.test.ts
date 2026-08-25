import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";
const NATIVE_ORIGIN = "https://localhost";

async function preflight(path: string, method: string): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: NATIVE_ORIGIN,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": "authorization,content-type,x-participant-id",
    },
  });
}

describe("versioned native preflight contract", () => {
  it("advertises only POST for room creation", async () => {
    const allowed = await preflight("/api/v1/rooms", "POST");
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect(allowed.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");

    const wrong = await preflight("/api/v1/rooms", "GET");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(wrong.headers.get("Cache-Control")).toBe("no-store");
  });

  it("advertises only GET for account snapshots", async () => {
    const allowed = await preflight("/api/v1/me", "GET");
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect(allowed.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");

    const wrong = await preflight("/api/v1/me", "POST");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not advertise unknown versioned paths", async () => {
    const response = await preflight("/api/v1/not-a-route", "POST");
    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

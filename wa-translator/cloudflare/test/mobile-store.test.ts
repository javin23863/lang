import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const PUBLIC_ORIGIN = "https://room.test";
const NATIVE_ORIGIN = "https://localhost";

describe("mobile store interface", () => {
  it("is accepted by the installed-client bootstrap validator", async () => {
    // The installed client deliberately remains plain ESM so Android, iOS and
    // this Worker contract test execute the same validator.
    // @ts-ignore No separate declaration file may drift from this module.
    const mobileContract = await import("../../mobile/src/runtime-core.mjs");
    const response = await exports.default.fetch(
      "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/api/v1/mobile/bootstrap",
      { headers: { Origin: NATIVE_ORIGIN } }
    );
    expect(response.status).toBe(200);
    const payload = await response.json<Record<string, unknown>>();
    expect(mobileContract.validateBootstrap(
      { ...payload, public_origin: mobileContract.PUBLIC_ORIGIN }, mobileContract.MOBILE_BUILD
    )).toBe(true);
  });

  it("publishes one versioned, no-store mobile bootstrap contract", async () => {
    const response = await exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/mobile/bootstrap`, {
      headers: { Origin: NATIVE_ORIGIN }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toContain("Origin");
    expect(await response.json()).toEqual({
      protocol: 1,
      minimum_client_build: 1,
      public_origin: PUBLIC_ORIGIN,
      account_mode: "none",
      call_lifecycle: "foreground",
      room_ttl_seconds: 86400,
      max_room_participants: 4,
      compute_capacity: { global_streams: 4, state: "beta-limited" },
      endpoints: {
        capabilities: "/api/v1/capabilities",
        rooms: "/api/v1/rooms",
        room: "/api/v1/room",
        room_control: "/api/v1/room-control",
        turn: "/api/v1/turn",
        reports: "/api/v1/reports",
        tts: "/api/v1/tts",
        websocket: "/ws/v1/{token}"
      }
    });
  });

  it("accepts only the native app origin across the versioned room seam", async () => {
    const preflight = await exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: NATIVE_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-participant-id"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization, Content-Type, X-Participant-ID"
    );

    const created = await exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/rooms`, {
      method: "POST", headers: { Origin: NATIVE_ORIGIN }
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect((await created.json<{ path: string }>()).path).toMatch(/^\/room\//);

    const denied = await exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/rooms`, {
      method: "POST", headers: { Origin: "https://attacker.test" }
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("serves exact Android and Apple association documents", async () => {
    const assetLinks = await exports.default.fetch(`${PUBLIC_ORIGIN}/.well-known/assetlinks.json`);
    expect(assetLinks.status).toBe(200);
    expect(assetLinks.headers.get("Content-Type")).toContain("application/json");
    expect(await assetLinks.json()).toEqual([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.javin23863.linguarelay",
        sha256_cert_fingerprints: [
          "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
        ]
      }
    }]);

    const association = await exports.default.fetch(
      `${PUBLIC_ORIGIN}/.well-known/apple-app-site-association`
    );
    expect(association.status).toBe(200);
    expect(association.headers.get("Content-Type")).toContain("application/json");
    expect(await association.json()).toEqual({ applinks: {
      apps: [], details: [{
        appID: "TESTTEAM01.com.javin23863.linguarelay",
        components: [{ "/": "/room/*", comment: "Private Lingua Relay rooms" }]
      }]
    }});
  });

  it("publishes store privacy, terms, and support surfaces", async () => {
    for (const [path, heading] of [
      ["/privacy", "Privacy"], ["/terms", "Terms"], ["/support", "Support"]
    ] as const) {
      const response = await exports.default.fetch(`${PUBLIC_ORIGIN}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const html = await response.text();
      expect(html).toContain(`<h1>${heading}</h1>`);
      expect(html).toContain("Lingua Relay");
      expect(html).not.toContain("TODO");
      expect(html).not.toContain("development");
    }
  });
});

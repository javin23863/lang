import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSession } from "./session";

const PUBLIC_ORIGIN = "https://room.test";
const NATIVE_ORIGIN = "https://localhost";

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieHeader(...responses: Response[]): string {
  const values = new Map<string, string>();
  for (const response of responses) {
    for (const cookie of setCookies(response)) {
      const pair = cookie.split(";")[0];
      const separator = pair.indexOf("=");
      if (separator > 0) values.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

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

  it("publishes one versioned, no-store two-person mobile bootstrap contract", async () => {
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
      account_mode: "session",
      call_lifecycle: "foreground",
      room_ttl_seconds: 86400,
      max_room_participants: 2,
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

  it("accepts a native session bearer for room creation and no other origin", async () => {
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
      method: "POST",
      headers: { Origin: NATIVE_ORIGIN, Authorization: `Bearer ${await hostSession()}` }
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect((await created.json<{ path: string }>()).path).toMatch(/^\/room\//);

    const denied = await exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/rooms`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
        Authorization: `Bearer ${await hostSession()}`
      }
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("returns OAuth to the app with a one-time handoff, then issues the native session", async () => {
    const nativeStart = await exports.default.fetch(`${PUBLIC_ORIGIN}/auth/native/google/start`, {
      redirect: "manual"
    });
    expect(nativeStart.status).toBe(302);
    expect(nativeStart.headers.get("Location")).toBe(`${PUBLIC_ORIGIN}/auth/google/start`);
    const marker = setCookies(nativeStart).find(value => value.startsWith("lr_native_oauth="))!;
    expect(marker).toContain("lr_native_oauth=google");
    expect(marker).toContain("SameSite=None");
    expect(marker).toContain("HttpOnly");

    const providerStart = await exports.default.fetch(nativeStart.headers.get("Location")!, {
      headers: {Cookie: cookieHeader(nativeStart)}, redirect: "manual"
    });
    expect(providerStart.status).toBe(302);
    const providerUrl = new URL(providerStart.headers.get("Location")!);
    const state = providerUrl.searchParams.get("state")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const callback = await exports.default.fetch(
      `${PUBLIC_ORIGIN}/auth/google/callback?code=fixture-google&state=${encodeURIComponent(state)}`,
      {headers: {Cookie: cookieHeader(nativeStart, providerStart)}, redirect: "manual"}
    );
    expect(callback.status).toBe(302);
    const completion = callback.headers.get("Location")!;
    expect(completion).toMatch(new RegExp(
      `^${PUBLIC_ORIGIN.replaceAll(".", "\\.")}\/mobile-auth-complete#handoff=nh1\\.`
    ));
    expect(completion).not.toContain("s1.");
    expect(setCookies(callback).some(cookie => cookie.startsWith("lr_s="))).toBe(false);
    const handoff = new URL(completion).hash.slice("#handoff=".length);

    const exchange = () => exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/auth/handoff`, {
      method: "POST",
      headers: {Origin: NATIVE_ORIGIN, "Content-Type": "application/json"},
      body: JSON.stringify({handoff})
    });
    const exchanged = await exchange();
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect(exchanged.headers.get("Cache-Control")).toBe("no-store");
    const {session} = await exchanged.json<{session: string}>();
    expect(session).toMatch(/^s1\.[A-Za-z0-9_-]{22}\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect((await exchange()).status).toBe(401);

    const account = await exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/me`, {
      headers: {Origin: NATIVE_ORIGIN, Authorization: `Bearer ${session}`}
    });
    expect(account.status).toBe(200);
    expect(account.headers.get("Access-Control-Allow-Origin")).toBe(NATIVE_ORIGIN);
    expect(await account.json()).toMatchObject({
      signed_in: true,
      user: {name: "Test Host", email: "host@example.test", provider: "google"}
    });

    const created = await exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/rooms`, {
      method: "POST",
      headers: {Origin: NATIVE_ORIGIN, Authorization: `Bearer ${session}`}
    });
    expect(created.status).toBe(201);
  });

  it("rejects native handoff exchange outside the installed app origin", async () => {
    const response = await exports.default.fetch(`${PUBLIC_ORIGIN}/api/v1/auth/handoff`, {
      method: "POST",
      headers: {Origin: "https://attacker.test", "Content-Type": "application/json"},
      body: JSON.stringify({handoff: "nh1.invalid"})
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
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
        components: [
          { "/": "/room/*", comment: "Private Lingua Relay rooms" },
          { "/": "/mobile-auth-complete", comment: "Lingua Relay native authentication return" }
        ]
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

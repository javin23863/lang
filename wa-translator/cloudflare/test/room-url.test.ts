import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";
const SECRET = "test-only-room-signing-key-32-bytes";

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signedToken(roomId: string, expires: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const payload = `${roomId}.${expires}`;
  const signature = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(payload)
  );
  return `${payload}.${base64url(signature)}`;
}

async function createRoom(): Promise<string> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: await hostSessionCookie() }
  });
  expect(response.status).toBe(201);
  return (await response.json<{ path: string }>()).path;
}

describe("public room URL interface", () => {
  it("keeps the legacy form route as a participant-only redirect", async () => {
    const response = await exports.default.fetch(new Request(`${ORIGIN}/rooms`, {
      method: "POST", headers: { Origin: ORIGIN, Cookie: await hostSessionCookie() },
      redirect: "manual"
    }));

    expect(response.status).toBe(303);
    const location = response.headers.get("Location");
    expect(location).toMatch(/^\/room\/[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(location).not.toContain("hc1.");
    expect((await exports.default.fetch(`${ORIGIN}${location}`)).status).toBe(200);
  });

  it("creates a signed 24-hour bearer and serves only a verified room", async () => {
    const path = await createRoom();
    const match = path.match(/^\/room\/([A-Za-z0-9_-]{24})\.(\d{10})\.([A-Za-z0-9_-]{43})$/);
    expect(match).not.toBeNull();
    expect(Number(match![2]) - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(86398);
    expect(Number(match![2]) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(86400);

    const page = await exports.default.fetch(`${ORIGIN}${path}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="voiceBtn"');
    expect(html).toContain('<select id="roleLocaleSel"');
    expect(html).toContain('id="joinBtn"');
    expect(html).not.toContain('id="localeSearch"');
    expect(html).not.toContain('id="roleChoices"');
    expect(html).toContain('<link rel="stylesheet" href="/room.css">');
    expect(html).toContain('<script src="/room.js"></script>');

    const js = await (await exports.default.fetch(`${ORIGIN}/room.js`)).text();
    expect(js).toContain('function localeOptionLabel(profile)');
    expect(js).toContain("profile.native_name + ' — ' + profile.display_name");
    const css = await (await exports.default.fetch(`${ORIGIN}/room.css`)).text();
    expect(css).toContain('overflow-y:auto');
    expect(css).toContain('max-height:calc(100dvh - 36px)');
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");

    const preflight = await exports.default.fetch(`${ORIGIN}/api/room`, {
      headers: {
        Authorization: `Bearer ${path.split("/").pop()!}`,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors"
      }
    });
    expect(preflight.status).toBe(204);

    // Mutating the final base64url character can change only discarded pad
    // bits and still decode to the same HMAC. Change a full signature sextet so
    // this negative is deterministic rather than intermittently equivalent.
    const [prefix, signature] = path.split(/\.(?=[^.]+$)/);
    const forged = `${prefix}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const denied = await exports.default.fetch(`${ORIGIN}${forged}`);
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain("signature");
    const deniedPreflight = await exports.default.fetch(`${ORIGIN}/api/room`, {
      headers: {
        Authorization: `Bearer ${forged.split("/").pop()!}`,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors"
      }
    });
    expect(deniedPreflight.status).toBe(401);
  });

  it("serves the same room page whatever mode the link asks for", async () => {
    // `?m=` is the participant's own furniture. The router matches on pathname,
    // nothing signs the mode, and an unknown value must not deny a valid room.
    const path = await createRoom();
    for (const query of ["?m=voice", "?m=chat", "?m=video", "?m=nonsense", "?m=voice&n=Ana%20R"]) {
      const page = await exports.default.fetch(`${ORIGIN}${path}${query}`);
      expect(page.status, query).toBe(200);
      expect(page.headers.get("Cache-Control")).toBe("no-store");
      expect(await page.text()).toContain('<script src="/room.js"></script>');
    }
    // The same external room implementation decides each participant's mode.
    const js = await (await exports.default.fetch(`${ORIGIN}/room.js`)).text();
    expect(js).toContain("document.body.dataset.mode = roomMode");
  });

  it("rejects expired bearers and cross-origin room creation", async () => {
    const expired = await signedToken("A2345678901234567890123", Math.floor(Date.now() / 1000) - 1);
    const page = await exports.default.fetch(`${ORIGIN}/room/${expired}`);
    expect(page.status).toBe(404);

    for (const origin of [undefined, "https://attacker.test"]) {
      const headers: HeadersInit = origin ? { Origin: origin } : {};
      const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, { method: "POST", headers });
      expect(response.status).toBe(403);
    }
  });
});

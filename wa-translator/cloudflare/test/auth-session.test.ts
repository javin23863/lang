import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";

type Snapshot = {
  signed_in: boolean;
  providers: string[];
  user?: { name: string; email: string; provider: string };
  credits?: { balance: number };
  totals?: Record<string, number>;
  recent?: unknown[];
};

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieValue(response: Response, name: string): string | null {
  const header = setCookies(response).find(value => value.startsWith(`${name}=`));
  if (!header) return null;
  return header.slice(name.length + 1).split(";")[0];
}

async function start(provider: string): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}/auth/${provider}/start`, { redirect: "manual" });
}

// A real browser hands the state cookie back on the callback; here the test is
// the browser, so it carries the same cookie the start response set.
async function signIn(
  provider = "google", code = "fixture-google"
): Promise<{ response: Response; session: string | null }> {
  const started = await start(provider);
  const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
  const response = await exports.default.fetch(
    `${ORIGIN}/auth/${provider}/callback?code=${code}&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: cookieHeader(started) }, redirect: "manual" }
  );
  return { response, session: cookieValue(response, "lr_s") };
}

function cookieHeader(response: Response): string {
  return setCookies(response).map(value => value.split(";")[0]).join("; ");
}

async function snapshot(session?: string | null): Promise<Snapshot> {
  const response = await exports.default.fetch(`${ORIGIN}/api/me`, {
    headers: session ? { Cookie: `lr_s=${session}` } : {}
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return response.json<Snapshot>();
}

describe("OAuth sign-in, session, and the room-creation gate", () => {
  it("starts a provider flow with a pinned redirect and a cross-site state cookie", async () => {
    const response = await start("google");

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location")!);
    expect(target.origin + target.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(target.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/google/callback`);
    expect(target.searchParams.get("response_type")).toBe("code");
    expect(target.searchParams.get("scope")).toBe("openid email profile");
    expect(target.searchParams.get("prompt")).toBe("select_account");
    const state = target.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const stateCookie = setCookies(response).find(value => value.startsWith("lr_oauth="))!;
    expect(stateCookie).toContain(`lr_oauth=google.${state}`);
    // Apple's form_post callback is a cross-site POST; a Lax state cookie
    // would not be sent with it and every Apple sign-in would fail.
    expect(stateCookie).toContain("SameSite=None");
    expect(stateCookie).toContain("Secure");
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("Max-Age=600");
  });

  it("mints a session from a valid callback and reports it on /api/me", async () => {
    const { response, session } = await signIn();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(session).toMatch(/^s1\.[A-Za-z0-9_-]{22}\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    const sessionCookie = setCookies(response).find(value => value.startsWith("lr_s="))!;
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Max-Age=2592000");
    // The state cookie is spent: it is cleared on the same response.
    expect(setCookies(response).some(value =>
      value.startsWith("lr_oauth=") && value.includes("Max-Age=0"))).toBe(true);

    const account = await snapshot(session);
    expect(account.signed_in).toBe(true);
    expect(account.user).toEqual({
      name: "Test Host", email: "host@example.test", provider: "google"
    });
    expect(account.credits).toEqual({ balance: 0 });
    expect(account.totals).toEqual({ call_minutes: 0, chat_messages: 0, tts_phrases: 0 });
    expect(account.recent).toEqual([]);
    // The provider's own subject never appears in anything we hand back.
    expect(JSON.stringify(account)).not.toContain("google-subject-1");
  });

  it("refuses a callback whose state does not match its cookie", async () => {
    const started = await start("google");
    const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;

    const forged = await exports.default.fetch(
      `${ORIGIN}/auth/google/callback?code=fixture-google&state=${state}x`,
      { headers: { Cookie: cookieHeader(started) }, redirect: "manual" }
    );
    expect(forged.status).toBe(302);
    expect(forged.headers.get("Location")).toBe("/?auth=failed");
    expect(cookieValue(forged, "lr_s")).toBeNull();

    const cookieless = await exports.default.fetch(
      `${ORIGIN}/auth/google/callback?code=fixture-google&state=${state}`,
      { redirect: "manual" }
    );
    expect(cookieless.status).toBe(302);
    expect(cookieless.headers.get("Location")).toBe("/?auth=failed");
    expect(cookieValue(cookieless, "lr_s")).toBeNull();

    // A state minted for one provider cannot be spent on another's callback.
    const crossed = await exports.default.fetch(
      `${ORIGIN}/auth/facebook/callback?code=fixture-facebook&state=${state}`,
      { headers: { Cookie: cookieHeader(started) }, redirect: "manual" }
    );
    expect(crossed.headers.get("Location")).toBe("/?auth=failed");
    expect(cookieValue(crossed, "lr_s")).toBeNull();
  });

  it("refuses an id_token from another audience, issuer, or an expired one", async () => {
    for (const code of [
      "fixture-google-foreign-audience",
      "fixture-google-foreign-issuer",
      "fixture-google-expired",
      "fixture-google-unusable-code",
    ]) {
      const { response, session } = await signIn("google", code);
      expect(response.headers.get("Location")).toBe("/?auth=failed");
      expect(session).toBeNull();
      expect(await response.text()).toBe("");
    }
  });

  it("signs in through the Facebook profile endpoint", async () => {
    const { session } = await signIn("facebook", "fixture-facebook");
    const account = await snapshot(session);

    expect(account.signed_in).toBe(true);
    expect(account.user).toEqual({
      name: "Facebook Host", email: "fb@example.test", provider: "facebook"
    });
  });

  it("offers only providers it holds credentials for", async () => {
    const account = await snapshot();
    expect(account.signed_in).toBe(false);
    expect(account.providers).toEqual(["google", "facebook"]);
    expect(account.user).toBeUndefined();

    // Apple has no credentials in this environment: no button, no dead route.
    const apple = await start("apple");
    expect(apple.status).toBe(404);
    expect(setCookies(apple)).toEqual([]);
    const unknown = await start("myspace");
    expect(unknown.status).toBe(404);
  });

  it("gates room creation on a session, and origin before that", async () => {
    const denied = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST", headers: { Origin: ORIGIN }
    });
    expect(denied.status).toBe(401);

    // A client-controlled native Origin is not a session. It gets the same 401,
    // and a cross-origin caller is refused before sign-in is even considered.
    const native = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST", headers: { Origin: "capacitor://localhost" }
    });
    expect(native.status).toBe(401);
    const foreign = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST", headers: { Origin: "https://attacker.test", Cookie: await hostSessionCookie() }
    });
    expect(foreign.status).toBe(403);

    const forged = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: "lr_s=s1.TestHostUser0123456789.9999999999.aaaa" }
    });
    expect(forged.status).toBe(401);

    const { session } = await signIn();
    const created = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST", headers: { Origin: ORIGIN, Cookie: `lr_s=${session}` }
    });
    expect(created.status).toBe(201);
  });

  it("clears the session on logout and refuses a cross-origin logout", async () => {
    const { session } = await signIn();

    const foreign = await exports.default.fetch(`${ORIGIN}/auth/logout`, {
      method: "POST", headers: { Origin: "https://attacker.test", Cookie: `lr_s=${session}` }
    });
    expect(foreign.status).toBe(403);

    const response = await exports.default.fetch(`${ORIGIN}/auth/logout`, {
      method: "POST", headers: { Origin: ORIGIN, Cookie: `lr_s=${session}` }
    });
    expect(response.status).toBe(204);
    expect(setCookies(response)[0]).toContain("lr_s=;");
    expect(setCookies(response)[0]).toContain("Max-Age=0");

    // Logout is a browser-side clear; the account itself survives it.
    expect((await snapshot(session)).signed_in).toBe(true);
    expect((await snapshot()).signed_in).toBe(false);
  });

  it("deletes the account and everything the directory held for it", async () => {
    const { session } = await signIn();
    expect((await snapshot(session)).signed_in).toBe(true);

    const unauthenticated = await exports.default.fetch(`${ORIGIN}/api/account/delete`, {
      method: "POST", headers: { Origin: ORIGIN }
    });
    expect(unauthenticated.status).toBe(401);
    const foreign = await exports.default.fetch(`${ORIGIN}/api/account/delete`, {
      method: "POST", headers: { Origin: "https://attacker.test", Cookie: `lr_s=${session}` }
    });
    expect(foreign.status).toBe(403);

    const deleted = await exports.default.fetch(`${ORIGIN}/api/account/delete`, {
      method: "POST", headers: { Origin: ORIGIN, Cookie: `lr_s=${session}` }
    });
    expect(deleted.status).toBe(204);
    expect(setCookies(deleted)[0]).toContain("Max-Age=0");

    // The cookie outlives the account by construction. It must not read as
    // signed in, and it must be cleared on the way out.
    const after = await exports.default.fetch(`${ORIGIN}/api/me`, {
      headers: { Cookie: `lr_s=${session}` }
    });
    expect((await after.clone().json<Snapshot>()).signed_in).toBe(false);
    expect(setCookies(after)[0]).toContain("Max-Age=0");
  });
});

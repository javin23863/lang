import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

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

function binding(): string {
  const bytes = new Uint8Array(32);
  bytes.fill(17);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challenge(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(value)
  ));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("native OAuth callback state", () => {
  it("does not consume a Google native marker on a wrong-method callback", async () => {
    const proof = binding();
    const nativeStart = await exports.default.fetch(
      `${ORIGIN}/auth/native/google/start?challenge=${encodeURIComponent(await challenge(proof))}`,
      {redirect: "manual"}
    );
    expect(nativeStart.status).toBe(302);
    expect(setCookies(nativeStart).some(value => value.startsWith("lr_native_oauth=google.")))
      .toBe(true);

    const wrongMethod = await exports.default.fetch(`${ORIGIN}/auth/google/callback`, {
      method: "POST",
      headers: {Cookie: cookieHeader(nativeStart)},
      redirect: "manual",
    });
    expect(wrongMethod.status).toBe(405);
    expect(setCookies(wrongMethod).some(value => value.startsWith("lr_native_oauth=")))
      .toBe(false);
    expect(setCookies(wrongMethod).some(value => value.startsWith("lr_oauth=")))
      .toBe(false);

    // The marker from the initiating response is still usable because the
    // wrong-method request was routed to the base 405 path without native
    // interception or cookie retirement.
    const providerStart = await exports.default.fetch(`${ORIGIN}/auth/google/start`, {
      headers: {Cookie: cookieHeader(nativeStart)},
      redirect: "manual",
    });
    expect(providerStart.status).toBe(302);
    expect(new URL(providerStart.headers.get("Location")!).searchParams.get("state"))
      .toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

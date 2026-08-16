// Creating a room needs a signed-in caller. Rather than drive a real Google
// round trip, this mints the same session cookie cloudflare/test/session.ts
// mints for vitest — the worker signs sessions with ROOM_SIGNING_KEY, so the
// local dev secret is all it takes. Export LINGUA_SESSION to paste a token
// obtained some other way (a real sign-in against a deployed worker).
export async function sessionToken() {
  if (process.env.LINGUA_SESSION) return process.env.LINGUA_SESSION;
  const secret = process.env.ROOM_SIGNING_KEY;
  if (!secret) return null;
  const userId = "TestHostUser0123456789";
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`session.v1.${userId}.${expiresAt}`)));
  const digest = btoa(String.fromCharCode(...signature))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `s1.${userId}.${expiresAt}.${digest}`;
}

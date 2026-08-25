import { env } from "cloudflare:workers";
import { mintSessionV2 } from "../src/session-v2";

// Every suite that creates a room needs a signed-in caller now. The fixture
// creates the matching account first so tests model the production invariant:
// a valid host session belongs to a still-existing UserDirectory profile.
const SECRET = "test-only-room-signing-key-32-bytes";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function ensureHostAccount(userId: string): Promise<void> {
  if (!USER_ID_PATTERN.test(userId)) return;
  const response = await env.USERS.get(env.USERS.idFromName(userId)).fetch(
    new Request("https://users.internal/", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        user_id: userId,
        provider: "google",
        name: "Test Host",
        email: `${userId.toLowerCase()}@example.test`,
      }),
    })
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`could not create test host account (${response.status})`);
  }
  await response.body?.cancel().catch(() => {});
}

export async function hostSession(
  userId = "TestHostUser0123456789", ttlSeconds = SESSION_TTL_SECONDS
): Promise<string> {
  await ensureHostAccount(userId);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`session.v1.${userId}.${expiresAt}`)
  );
  return `s1.${userId}.${expiresAt}.${base64url(signature)}`;
}

export async function hostSessionV2(
  userId = "TestHostUser0123456789", ttlSeconds = SESSION_TTL_SECONDS
): Promise<string> {
  await ensureHostAccount(userId);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return (await mintSessionV2(userId, SECRET, expiresAt)).token;
}

export async function hostSessionCookie(userId?: string): Promise<string> {
  return `lr_s=${await hostSession(userId)}`;
}

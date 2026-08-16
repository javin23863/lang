// Every suite that creates a room needs a signed-in caller now. Minting the
// cookie here keeps the eight local createRoom() helpers to one added line and
// keeps the session format in exactly one place.
const SECRET = "test-only-room-signing-key-32-bytes";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hostSession(
  userId = "TestHostUser0123456789", ttlSeconds = SESSION_TTL_SECONDS
): Promise<string> {
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

export async function hostSessionCookie(userId?: string): Promise<string> {
  return `lr_s=${await hostSession(userId)}`;
}

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SESSION_V1_PURPOSE = "session.v1";
const SESSION_V2_PURPOSE = "session.v2";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_MAX_FUTURE_SECONDS = 31 * 24 * 60 * 60;

export const SESSION_V1_PATTERN = /^s1\.([A-Za-z0-9_-]{22})\.(\d{10})\.([A-Za-z0-9_-]{43})$/;
export const SESSION_V2_PATTERN = /^s2\.([A-Za-z0-9_-]{22})\.(\d{10})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

export type SessionIdentity = {
  token: string;
  userId: string;
  expiresAt: number;
  digest: string;
  legacyToken: string;
  version: 1 | 2;
};

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function canonicalBase64url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
      + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const decoded = Uint8Array.from(binary, character => character.charCodeAt(0));
    return base64url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

function validSecret(secret: string): boolean {
  return new TextEncoder().encode(secret || "").byteLength >= 32;
}

function validExpiry(expiresAt: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Number.isSafeInteger(expiresAt)
    && expiresAt > now
    && expiresAt <= now + SESSION_MAX_FUTURE_SECONDS;
}

async function hmacKey(secret: string, usage: ("sign" | "verify")[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    {name: "HMAC", hash: "SHA-256"}, false, usage
  );
}

async function signPayload(payload: string, secret: string): Promise<string> {
  if (!validSecret(secret)) throw new Error("session signing unavailable");
  return base64url(await crypto.subtle.sign(
    "HMAC", await hmacKey(secret, ["sign"]), new TextEncoder().encode(payload)
  ));
}

async function verifyPayload(payload: string, signature: string, secret: string): Promise<boolean> {
  if (!validSecret(secret) || !SIGNATURE_PATTERN.test(signature)) return false;
  const bytes = canonicalBase64url(signature);
  if (!bytes || bytes.byteLength !== 32) return false;
  return crypto.subtle.verify(
    "HMAC", await hmacKey(secret, ["verify"]),
    bytes.buffer as ArrayBuffer, new TextEncoder().encode(payload)
  );
}

async function legacyToken(userId: string, expiresAt: number, secret: string): Promise<string> {
  const payload = `${SESSION_V1_PURPOSE}.${userId}.${expiresAt}`;
  return `s1.${userId}.${expiresAt}.${await signPayload(payload, secret)}`;
}

async function tokenDigest(token: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

export async function inspectSessionToken(token: string, secret: string): Promise<SessionIdentity | null> {
  const v2 = token.match(SESSION_V2_PATTERN);
  if (v2) {
    const [, userId, expiresRaw, nonce, signature] = v2;
    const expiresAt = Number(expiresRaw);
    if (!USER_ID_PATTERN.test(userId) || !NONCE_PATTERN.test(nonce) || !validExpiry(expiresAt)) return null;
    const payload = `${SESSION_V2_PURPOSE}.${userId}.${expiresRaw}.${nonce}`;
    if (!await verifyPayload(payload, signature, secret)) return null;
    return {
      token, userId, expiresAt, version: 2,
      digest: await tokenDigest(token),
      legacyToken: await legacyToken(userId, expiresAt, secret),
    };
  }

  const v1 = token.match(SESSION_V1_PATTERN);
  if (!v1) return null;
  const [, userId, expiresRaw, signature] = v1;
  const expiresAt = Number(expiresRaw);
  if (!USER_ID_PATTERN.test(userId) || !validExpiry(expiresAt)) return null;
  const payload = `${SESSION_V1_PURPOSE}.${userId}.${expiresRaw}`;
  if (!await verifyPayload(payload, signature, secret)) return null;
  return {
    token, userId, expiresAt, version: 1,
    digest: await tokenDigest(token),
    legacyToken: token,
  };
}

export async function mintSessionV2(
  userId: string, secret: string, expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
): Promise<{token: string; expiresAt: number}> {
  if (!USER_ID_PATTERN.test(userId) || !validSecret(secret) || !validExpiry(expiresAt)) {
    throw new Error("session signing unavailable");
  }
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${SESSION_V2_PURPOSE}.${userId}.${expiresAt}.${nonce}`;
  const signature = await signPayload(payload, secret);
  return {token: `s2.${userId}.${expiresAt}.${nonce}.${signature}`, expiresAt};
}

export async function upgradeSessionV1(token: string, secret: string): Promise<string | null> {
  const identity = await inspectSessionToken(token, secret);
  if (!identity || identity.version !== 1) return null;
  return (await mintSessionV2(identity.userId, secret, identity.expiresAt)).token;
}

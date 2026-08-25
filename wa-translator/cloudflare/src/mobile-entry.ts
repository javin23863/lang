import worker, { type Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory } from "./worker";

const NATIVE_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const NATIVE_OAUTH_COOKIE = "lr_native_oauth";
const OAUTH_STATE_COOKIE = "lr_oauth";
const NATIVE_HANDOFF_PREFIX = "nh1";
const NATIVE_HANDOFF_PURPOSE = "native-handoff.v1";
const NATIVE_HANDOFF_TTL_SECONDS = 90;
const SESSION_PREFIX = "s1";
const SESSION_PURPOSE = "session.v1";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_COOKIE = "lr_s";
const MOBILE_APP_ID = "com.javin23863.linguarelay";
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SESSION_PATTERN = /^s1\.[A-Za-z0-9_-]{22}\.\d{10}\.[A-Za-z0-9_-]{43}$/;
const PROVIDERS = new Set(["google", "apple", "facebook"]);
const NATIVE_SESSION_PATHS = new Map([
  ["/api/v1/me", "/api/me"],
  ["/api/v1/account/delete", "/api/account/delete"],
  ["/api/v1/auth/logout", "/auth/logout"],
]);

function expectedOrigin(request: Request, env: Env): string {
  return env.PUBLIC_ORIGIN || new URL(request.url).origin;
}

function nativeOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  return origin && NATIVE_ORIGINS.has(origin) ? origin : null;
}

function privateHeaders(source?: Headers): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function nativeCors(request: Request, response: Response): Response {
  const origin = nativeOrigin(request);
  if (!origin || response.webSocket) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return new Response(response.body, {status: response.status, headers});
}

// Cloudflare gives the top-level fetch handler an IncomingRequestCfProperties
// marker. Rebuilding a Request to rewrite its path preserves the runtime data
// but widens the TypeScript generic. Keep that type-only mismatch at one seam.
function routeWorker(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return worker.fetch(request as never, env, ctx);
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function canonicalBase64url(value: string): Uint8Array | null {
  try {
    const decoded = fromBase64url(value);
    return base64url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: ("sign" | "verify")[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    {name: "HMAC", hash: "SHA-256"}, false, usage
  );
}

function signingSecretIsValid(secret: string): boolean {
  return new TextEncoder().encode(secret || "").byteLength >= 32;
}

async function signSession(userId: string, secret: string): Promise<{token: string; expiresAt: number}> {
  if (!USER_ID_PATTERN.test(userId) || !signingSecretIsValid(secret)) {
    throw new Error("native session signing unavailable");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${SESSION_PURPOSE}.${userId}.${expiresAt}`;
  const signature = await crypto.subtle.sign(
    "HMAC", await hmacKey(secret, ["sign"]), new TextEncoder().encode(payload)
  );
  return {token: `${SESSION_PREFIX}.${userId}.${expiresAt}.${base64url(signature)}`, expiresAt};
}

async function signNativeHandoff(userId: string, secret: string): Promise<string> {
  if (!USER_ID_PATTERN.test(userId) || !signingSecretIsValid(secret)) {
    throw new Error("native handoff signing unavailable");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + NATIVE_HANDOFF_TTL_SECONDS;
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${NATIVE_HANDOFF_PURPOSE}.${userId}.${expiresAt}.${nonce}`;
  const signature = await crypto.subtle.sign(
    "HMAC", await hmacKey(secret, ["sign"]), new TextEncoder().encode(payload)
  );
  return `${NATIVE_HANDOFF_PREFIX}.${userId}.${expiresAt}.${nonce}.${base64url(signature)}`;
}

async function verifyNativeHandoff(
  token: string, secret: string
): Promise<{userId: string; nonce: string} | null> {
  if (!signingSecretIsValid(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [prefix, userId, expiresRaw, nonce, signature] = parts;
  if (prefix !== NATIVE_HANDOFF_PREFIX || !USER_ID_PATTERN.test(userId)
      || !/^\d{10}$/.test(expiresRaw) || !NONCE_PATTERN.test(nonce)
      || !SIGNATURE_PATTERN.test(signature)) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const signatureBytes = canonicalBase64url(signature);
  if (!signatureBytes) return null;
  const valid = await crypto.subtle.verify(
    "HMAC", await hmacKey(secret, ["verify"]),
    signatureBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(`${NATIVE_HANDOFF_PURPOSE}.${userId}.${expiresRaw}.${nonce}`)
  );
  return valid ? {userId, nonce} : null;
}

function readCookie(request: Request, name: string): string | null {
  for (const pair of (request.headers.get("Cookie") || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return null;
}

function nativeMarkerCookie(provider: string): string {
  return `${NATIVE_OAUTH_COOKIE}=${provider}; HttpOnly; Secure; SameSite=None; Path=/auth; Max-Age=600`;
}

function clearNativeMarkerCookie(): string {
  return `${NATIVE_OAUTH_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/auth; Max-Age=0`;
}

function clearOauthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/auth; Max-Age=0`;
}

function extractSession(headers: Headers): string | null {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie() : [headers.get("Set-Cookie") || ""];
  for (const value of values) {
    const match = value.match(/(?:^|,\s*)lr_s=([^;,\s]+)/);
    if (match && SESSION_PATTERN.test(match[1])) return match[1];
  }
  return null;
}

function sessionUserId(token: string): string | null {
  if (!SESSION_PATTERN.test(token)) return null;
  const userId = token.split(".")[1];
  return USER_ID_PATTERN.test(userId) ? userId : null;
}

async function readLimited(
  stream: ReadableStream<Uint8Array> | null, maxBytes: number
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function withNativeSession(request: Request, targetPath?: string): Request {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const url = new URL(request.url);
  if (targetPath) url.pathname = targetPath;
  const forwarded = new Request(url.toString(), request);
  if (!SESSION_PATTERN.test(token)) return forwarded;
  const headers = new Headers(forwarded.headers);
  const existing = headers.get("Cookie");
  headers.set("Cookie", `${existing ? `${existing}; ` : ""}${SESSION_COOKIE}=${token}`);
  return new Request(forwarded, {headers});
}

async function nativeAuthStart(request: Request, env: Env, provider: string): Promise<Response> {
  if (request.method !== "GET" || !PROVIDERS.has(provider)) {
    return new Response("Not Found", {status: 404, headers: privateHeaders()});
  }
  const headers = privateHeaders();
  headers.set("Location", `${expectedOrigin(request, env)}/auth/${provider}/start`);
  headers.append("Set-Cookie", nativeMarkerCookie(provider));
  return new Response(null, {status: 302, headers});
}

async function nativeAuthCallback(
  request: Request, env: Env, ctx: ExecutionContext, provider: string
): Promise<Response> {
  if (readCookie(request, NATIVE_OAUTH_COOKIE) !== provider) {
    return routeWorker(request, env, ctx);
  }
  const upstream = await routeWorker(request, env, ctx);
  const session = extractSession(upstream.headers);
  const userId = session ? sessionUserId(session) : null;
  // Never persist the browser session minted by the shared callback into the
  // system browser. Native receives only the short handoff below.
  const headers = privateHeaders(upstream.headers);
  headers.delete("Set-Cookie");
  headers.append("Set-Cookie", clearOauthStateCookie());
  headers.append("Set-Cookie", clearNativeMarkerCookie());
  if (!userId) {
    headers.set("Location", `${expectedOrigin(request, env)}/mobile-auth-complete#auth=failed`);
    return new Response(null, {status: 302, headers});
  }
  try {
    const handoff = await signNativeHandoff(userId, env.ROOM_SIGNING_KEY);
    headers.set("Location", `${expectedOrigin(request, env)}/mobile-auth-complete#handoff=${handoff}`);
    return new Response(null, {status: 302, headers});
  } catch {
    headers.set("Location", `${expectedOrigin(request, env)}/mobile-auth-complete#auth=failed`);
    return new Response(null, {status: 302, headers});
  }
}

async function consumeNativeHandoff(env: Env, nonce: string): Promise<boolean> {
  const response = await env.ABUSE.get(env.ABUSE.idFromName(`native-handoff:${nonce}`)).fetch(
    new Request("https://abuse.internal/consume", {
      method: "POST",
      headers: {
        "X-Quota-Limit": "1",
        "X-Quota-Window-Ms": String(NATIVE_HANDOFF_TTL_SECONDS * 1000),
      }
    })
  );
  return response.status === 204;
}

async function nativeHandoffExchange(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return nativeCors(
    request, new Response("Method Not Allowed", {status: 405, headers: privateHeaders()})
  );
  if (!nativeOrigin(request)) {
    return new Response("Forbidden", {status: 403, headers: privateHeaders()});
  }
  const raw = await readLimited(request.body, 512);
  if (!raw) return nativeCors(
    request, new Response("Request body is too large", {status: 413, headers: privateHeaders()})
  );
  let handoff = "";
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.handoff !== "string") throw new Error();
    handoff = record.handoff;
  } catch {
    return nativeCors(
      request, new Response("Invalid handoff", {status: 400, headers: privateHeaders()})
    );
  }
  const verified = await verifyNativeHandoff(handoff, env.ROOM_SIGNING_KEY);
  if (!verified || !await consumeNativeHandoff(env, verified.nonce)) return nativeCors(
    request, new Response("Invalid handoff", {status: 401, headers: privateHeaders()})
  );
  // A handoff issued before account deletion must not recreate a usable native
  // session after deletion. The UserDirectory is the account authority.
  const user = await env.USERS.get(env.USERS.idFromName(verified.userId)).fetch(
    new Request("https://users.internal/")
  );
  if (!user.ok) return nativeCors(
    request, new Response("Account unavailable", {status: 401, headers: privateHeaders()})
  );
  try {
    const session = await signSession(verified.userId, env.ROOM_SIGNING_KEY);
    return nativeCors(request, Response.json({
      session: session.token, expires_at: session.expiresAt
    }, {headers: privateHeaders()}));
  } catch {
    return nativeCors(
      request, new Response("Authentication unavailable", {status: 503, headers: privateHeaders()})
    );
  }
}

function appleAssociation(env: Env): Response {
  const teamId = env.MOBILE_APPLE_TEAM_ID || "";
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    return new Response("Apple association is not configured", {
      status: 503, headers: {"Cache-Control": "no-store"}
    });
  }
  return Response.json({applinks: {
    apps: [], details: [{
      appID: `${teamId}.${MOBILE_APP_ID}`,
      components: [
        {"/": "/room/*", comment: "Private Lingua Relay rooms"},
        {"/": "/mobile-auth-complete", comment: "Lingua Relay native authentication return"},
      ],
    }]
  }}, {headers: {"Cache-Control": "public, max-age=3600"}});
}

function mobileAuthComplete(request: Request): Response {
  if (request.method !== "GET") return new Response("Method Not Allowed", {
    status: 405, headers: privateHeaders()
  });
  const headers = privateHeaders();
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response("Authentication completed. Return to Lingua Relay.", {headers});
}

async function nativeSessionApi(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  if (request.method === "OPTIONS") return null;
  const url = new URL(request.url);
  if (url.pathname === "/api/v1/rooms") {
    return routeWorker(withNativeSession(request), env, ctx);
  }
  const target = NATIVE_SESSION_PATHS.get(url.pathname);
  if (!target) return null;
  if (!nativeOrigin(request)) {
    return new Response("Forbidden", {status: 403, headers: privateHeaders()});
  }
  const response = await routeWorker(withNativeSession(request, target), env, ctx);
  return nativeCors(request, response);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const nativeStart = url.pathname.match(/^\/auth\/native\/([a-z]{1,20})\/start$/);
    if (nativeStart) return nativeAuthStart(request, env, nativeStart[1]);

    const callback = url.pathname.match(/^\/auth\/([a-z]{1,20})\/callback$/);
    if (callback && PROVIDERS.has(callback[1])) {
      return nativeAuthCallback(request, env, ctx, callback[1]);
    }

    if (url.pathname === "/mobile-auth-complete") return mobileAuthComplete(request);
    if (url.pathname === "/.well-known/apple-app-site-association") {
      return appleAssociation(env);
    }
    if (url.pathname === "/api/v1/auth/handoff") {
      if (request.method === "OPTIONS") return routeWorker(request, env, ctx);
      return nativeHandoffExchange(request, env);
    }

    const nativeApi = await nativeSessionApi(request, env, ctx);
    return nativeApi || routeWorker(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;

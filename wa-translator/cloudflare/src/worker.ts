import { DurableObject } from "cloudflare:workers";
import privacyHtml from "../../windows/static/privacy.html";
import roomHtml from "../../windows/static/room.html";
import supportHtml from "../../windows/static/support.html";
import termsHtml from "../../windows/static/terms.html";
import {
  CATALOG_REVISION, M2M_MODEL, isJoinableLocale,
  localeProfile, publicCatalog, voiceProfile,
  type LocaleProfile, type VoiceProfile,
} from "./catalog";

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<Room>;
  ABUSE: DurableObjectNamespace<AbuseGate>;
  REPORTS: DurableObjectNamespace<ReportInbox>;
  USERS: DurableObjectNamespace<UserDirectory>;
  REPORTS_TEST?: Fetcher;
  PUBLIC_ORIGIN?: string;
  ROOM_SIGNING_KEY: string;
  TURN_TTL_SECONDS: string;
  TURN_KEY_ID: string;
  TURN_API_TOKEN: string;
  TURN_TEST?: Fetcher;
  MODAL_SHARED_SECRET: string;
  MODAL_WS_URL: string;
  MODAL_TTS_URL: string;
  MODAL_TEST?: Fetcher;
  MOBILE_ANDROID_CERT_SHA256?: string;
  MOBILE_APPLE_TEAM_ID?: string;
  MOBILE_REPORT_ADMIN_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  OAUTH_TEST?: Fetcher;
}

const ROOM_ID_BYTES = 18;
const ROOM_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HOST_CONTROL_PREFIX = "hc1";
const HOST_CONTROL_PURPOSE = "host-control.v1";
const ROOM_CLOSED_CLOSE_CODE = 4001;
const CONTROL_MESSAGE_BYTES = 8192;
const SIGNAL_MESSAGE_BYTES = 64 * 1024;
const MAX_PCM_FRAME_BYTES = 32000;
const MAX_COMPUTE_MESSAGE_BYTES = 8192;
const MAX_CAPTION_CHARS = 300;
const COMPUTE_BACKOFF_MAX_MS = 8000;
const MAX_TTS_BODY_BYTES = 2048;
const MAX_TTS_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TTS_CHARS = 300;
const MAX_CHAT_CHARS = 200;
// Typed messages are numbered off a base no caption sequence can reach, so a
// chat bubble and a caption bubble never collide on one "speaker:seq" key.
const CHAT_SEQ_BASE = 1_000_000;
const CHAT_WINDOW_MS = 60_000;
const CHAT_MESSAGES_PER_WINDOW = 60;
const CHAT_TRANSLATE_TIMEOUT_MS = 8000;
const TURN_TTL_MAX_SECONDS = 48 * 60 * 60;
const MAX_PARTICIPANTS = 4;
const MAX_PENDING_SOCKETS = 8;
const PRESENCE_HEARTBEAT_MS = 10_000;
// Hidden mobile browsers may coalesce timers to one wake per minute. Keep the
// heartbeat cheap at 10s, but leave enough margin that the foreground peer's
// heartbeat cannot evict a still-open background peer before its next wake.
const PRESENCE_LEASE_MS = 90_000;
const PCM_RATE_BYTES_PER_SECOND = 40_000;
const PCM_BURST_BYTES = 64_000;
const TTS_WINDOW_MS = 60_000;
const TTS_REQUESTS_PER_WINDOW = 12;
const MOBILE_PROTOCOL = 1;
const MOBILE_MINIMUM_BUILD = 1;
const MOBILE_APP_ID = "com.javin23863.linguarelay";
const MOBILE_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const REPORT_CATEGORIES = new Set(["harassment", "threat", "sexual", "hate", "scam", "other"]);
const REPORT_PLATFORMS = new Set(["web", "native", "android", "ios"]);
const ROOM_CREATION_WINDOW_MS = 10 * 60 * 1000;
const ROOM_CREATION_LIMIT = 12;
const TURN_IP_WINDOW_MS = 60 * 60 * 1000;
const TURN_IP_LIMIT = 48;
const TURN_ROOM_WINDOW_MS = 60 * 60 * 1000;
const TURN_ROOM_LIMIT = 12;
const SESSION_COOKIE = "lr_s";
const SESSION_PREFIX = "s1";
const SESSION_PURPOSE = "session.v1";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_STATE_COOKIE = "lr_oauth";
const OAUTH_STATE_TTL_SECONDS = 600;
const OAUTH_CALLBACK_BODY_BYTES = 8192;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const USAGE_MAX_RECORDS = 200;
const USAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const USAGE_TOTALS = new Map([
  ["call", "call_minutes"], ["chat", "chat_messages"], ["tts", "tts_phrases"],
]);
const REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const REPORT_MAX_RECORDS = 500;
const REPORT_ROOM_LIMIT = 8;
const REPORT_IP_LIMIT = 12;
const REPORT_IP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MOBILE_API_ALIASES = new Map([
  ["/api/v1/capabilities", "/api/capabilities"],
  ["/api/v1/rooms", "/api/rooms"],
  ["/api/v1/room", "/api/room"],
  ["/api/v1/room-control", "/api/room-control"],
  ["/api/v1/room-control/close", "/api/room-control/close"],
  ["/api/v1/turn", "/api/turn"],
  ["/api/v1/reports", "/api/reports"],
  ["/api/v1/tts", "/tts"],
]);
const PUBLIC_PAGES = new Map([
  ["/privacy", privacyHtml],
  ["/terms", termsHtml],
  ["/support", supportHtml],
]);
type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type ParticipantAttachment = {
  kind: "browser";
  id: string;
  joined: boolean;
  locale: string;
  lang: string;
  name: string;
  voiceProfileId: string | null;
  lastSeenAt: number;
  ttsWindowStart: number;
  ttsCount: number;
  reported?: boolean;
};

type ComputeState = {
  socket: WebSocket | null;
  connecting: Promise<WebSocket | null> | null;
  failures: number;
  nextAttempt: number;
  generation: number;
  abort: AbortController | null;
};

type ComputeRoute = {
  sourceLocale: string;
  sourceLanguage: string;
  targetLanguages: string[];
};

type LocaleVoiceSelection =
  | { locale: LocaleProfile; voice: VoiceProfile | null }
  | { reason: "unsupported locale" | "unsupported voice profile" };

type PcmBudget = { tokens: number; updatedAt: number };

type RoomUsage = { callMs: number; chat: number; tts: number };

const EMPTY_USAGE: RoomUsage = { callMs: 0, chat: 0, tts: 0 };

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
    // HMAC verification is over bytes. Without re-encoding, distinct terminal
    // Base64URL characters can decode to the same bytes through unused padding
    // bits and turn one bearer into multiple textual representations.
    return base64url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

async function signingKey(secret: string, usage: ("sign" | "verify")[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  );
}

function signingSecretIsValid(secret: string): boolean {
  return new TextEncoder().encode(secret || "").byteLength >= 32;
}

async function signRoom(roomId: string, expiresAt: number, secret: string): Promise<string> {
  const payload = `${roomId}.${expiresAt}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret, ["sign"]),
    new TextEncoder().encode(payload)
  );
  return `${payload}.${base64url(signature)}`;
}

type VerifiedRoom = { id: string; expiresAt: number };

async function signHostControl(roomId: string, expiresAt: number, secret: string): Promise<string> {
  const payload = `${HOST_CONTROL_PURPOSE}.${roomId}.${expiresAt}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret, ["sign"]),
    new TextEncoder().encode(payload)
  );
  return `${HOST_CONTROL_PREFIX}.${roomId}.${expiresAt}.${base64url(signature)}`;
}

async function verifyRoom(token: string, secret: string): Promise<VerifiedRoom | null> {
  if (!signingSecretIsValid(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expiresRaw, signature] = parts;
  if (!ROOM_ID_PATTERN.test(id) || !/^\d{10}$/.test(expiresRaw)
      || !SIGNATURE_PATTERN.test(signature)) return null;
  const signatureBytes = canonicalBase64url(signature);
  if (!signatureBytes) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret, ["verify"]),
    signatureBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(`${id}.${expiresRaw}`)
  );
  return valid ? { id, expiresAt } : null;
}

async function verifyHostControl(token: string, secret: string): Promise<VerifiedRoom | null> {
  if (!signingSecretIsValid(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, id, expiresRaw, signature] = parts;
  if (prefix !== HOST_CONTROL_PREFIX || !ROOM_ID_PATTERN.test(id)
      || !/^\d{10}$/.test(expiresRaw) || !SIGNATURE_PATTERN.test(signature)) return null;
  const signatureBytes = canonicalBase64url(signature);
  if (!signatureBytes) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const payload = `${HOST_CONTROL_PURPOSE}.${id}.${expiresRaw}`;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret, ["verify"]),
    signatureBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(payload)
  );
  return valid ? { id, expiresAt } : null;
}

// Sessions are the third token family off the one room signing key. Same
// construction as the two above: a signed payload, no server-side session
// table, and nothing in the cookie that is not already public to its holder.
async function signSession(userId: string, expiresAt: number, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret, ["sign"]),
    new TextEncoder().encode(`${SESSION_PURPOSE}.${userId}.${expiresAt}`)
  );
  return `${SESSION_PREFIX}.${userId}.${expiresAt}.${base64url(signature)}`;
}

async function verifySession(token: string, secret: string): Promise<string | null> {
  if (!signingSecretIsValid(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, userId, expiresRaw, signature] = parts;
  if (prefix !== SESSION_PREFIX || !USER_ID_PATTERN.test(userId)
      || !/^\d{10}$/.test(expiresRaw) || !SIGNATURE_PATTERN.test(signature)) return null;
  const signatureBytes = canonicalBase64url(signature);
  if (!signatureBytes) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret, ["verify"]),
    signatureBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(`${SESSION_PURPOSE}.${userId}.${expiresRaw}`)
  );
  return valid ? userId : null;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/;`
    + ` Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
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

async function sessionUser(request: Request, env: Env): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  return token ? verifySession(token, env.ROOM_SIGNING_KEY) : null;
}

// One opaque, irreversible reference for everything that must be storable but
// never re-identifying: report room refs, submission ids, user ids, usage rows.
async function opaqueDigest(value: string, length: number): Promise<string> {
  return base64url(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(value)
  )).slice(0, length);
}

function expectedOrigin(request: Request, env: Env): string {
  return env.PUBLIC_ORIGIN || new URL(request.url).origin;
}

function nativeOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  return origin && MOBILE_ORIGINS.has(origin) ? origin : null;
}

function sameOrigin(request: Request, env: Env): boolean {
  return request.headers.get("Origin") === expectedOrigin(request, env)
    || nativeOrigin(request) !== null;
}

function sameOriginBrowserGet(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === expectedOrigin(request, env)
    || MOBILE_ORIGINS.has(origin);
  return request.method === "GET"
    && request.headers.get("Sec-Fetch-Site") === "same-origin"
    && ["cors", "same-origin"].includes(request.headers.get("Sec-Fetch-Mode") || "");
}

function mobileCors(request: Request, response: Response): Response {
  const origin = nativeOrigin(request);
  if (!origin || response.webSocket) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

function mobilePreflight(request: Request): Response {
  const origin = nativeOrigin(request);
  if (!origin) return new Response("Forbidden", { status: 403 });
  const requestedMethod = request.headers.get("Access-Control-Request-Method");
  if (!requestedMethod || !["GET", "POST"].includes(requestedMethod.toUpperCase())) {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Participant-ID",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  }});
}

function mobileBootstrap(request: Request, env: Env): Response {
  return Response.json({
    protocol: MOBILE_PROTOCOL,
    minimum_client_build: MOBILE_MINIMUM_BUILD,
    public_origin: expectedOrigin(request, env),
    account_mode: "session",
    call_lifecycle: "foreground",
    room_ttl_seconds: ROOM_TOKEN_TTL_SECONDS,
    max_room_participants: MAX_PARTICIPANTS,
    compute_capacity: { global_streams: 4, state: "beta-limited" },
    endpoints: {
      capabilities: "/api/v1/capabilities",
      rooms: "/api/v1/rooms",
      room: "/api/v1/room",
      room_control: "/api/v1/room-control",
      turn: "/api/v1/turn",
      reports: "/api/v1/reports",
      tts: "/api/v1/tts",
      websocket: "/ws/v1/{token}",
    }
  }, { headers: { "Cache-Control": "no-store" } });
}

function androidAssociation(env: Env): Response {
  const fingerprint = (env.MOBILE_ANDROID_CERT_SHA256 || "").toUpperCase();
  if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)) {
    return new Response("Android association is not configured", {
      status: 503, headers: { "Cache-Control": "no-store" }
    });
  }
  return Response.json([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: MOBILE_APP_ID,
      sha256_cert_fingerprints: [fingerprint],
    }
  }], { headers: { "Cache-Control": "public, max-age=3600" } });
}

function appleAssociation(env: Env): Response {
  const teamId = env.MOBILE_APPLE_TEAM_ID || "";
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    return new Response("Apple association is not configured", {
      status: 503, headers: { "Cache-Control": "no-store" }
    });
  }
  return Response.json({ applinks: {
    apps: [], details: [{
      appID: `${teamId}.${MOBILE_APP_ID}`,
      components: [{ "/": "/room/*", comment: "Private Lingua Relay rooms" }],
    }]
  }}, { headers: { "Cache-Control": "public, max-age=3600" } });
}

function privateHeaders(source?: Headers): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Permissions-Policy", "camera=(self), microphone=(self)");
  return headers;
}

function deniedRoom(): Response {
  return new Response("This private room does not exist or has expired.", {
    status: 404,
    headers: privateHeaders()
  });
}

async function createRoomResponse(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response> {
  // Order is load-bearing: a cross-origin caller is refused before it can learn
  // whether it is signed in, and neither state costs an abuse-quota token.
  // capacitor://localhost is client-controlled, so native creation gets no
  // exemption here — it 401s until a native token exchange exists.
  if (!sameOrigin(request, env)) return new Response("Forbidden", { status: 403 });
  if (!signingSecretIsValid(env.ROOM_SIGNING_KEY)) {
    return new Response("Room service is unavailable", { status: 503 });
  }
  const userId = await sessionUser(request, env);
  if (!userId) {
    return new Response("Sign in required", { status: 401, headers: privateHeaders() });
  }
  const limited = await consumeIpQuota(
    request, env, "room-create", ROOM_CREATION_LIMIT, ROOM_CREATION_WINDOW_MS
  );
  if (limited) return limited;
  const roomBytes = crypto.getRandomValues(new Uint8Array(ROOM_ID_BYTES));
  const expiresAt = Math.floor(Date.now() / 1000) + ROOM_TOKEN_TTL_SECONDS;
  const roomId = base64url(roomBytes);
  const token = await signRoom(roomId, expiresAt, env.ROOM_SIGNING_KEY);
  const path = `/room/${token}`;
  const hostControl = await signHostControl(roomId, expiresAt, env.ROOM_SIGNING_KEY);
  // The first page view wakes this object anyway (roomIsAvailable), so naming
  // its owner now adds no new cost class and keeps the caller's 201 immediate.
  ctx.waitUntil(env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(
    new Request("https://room.internal/owner", {
      method: "POST",
      headers: { "X-Room-Expires": String(expiresAt), "X-User-ID": userId }
    })
  ).catch(() => { /* metering is never worth failing a room on */ }));
  ctx.waitUntil(warmCompute(env));
  return Response.json({ path, host_control: hostControl, expires_at: expiresAt }, {
    status: 201, headers: privateHeaders()
  });
}

async function createRoomRedirect(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response> {
  const created = await createRoomResponse(request, env, ctx);
  if (!created.ok) return created;
  const { path } = await created.json<{ path: string }>();
  const headers = privateHeaders();
  headers.set("Location", path);
  return new Response(null, { status: 303, headers });
}

async function roomPage(
  request: Request, env: Env, token: string, ctx: ExecutionContext
): Promise<Response> {
  const room = await verifyRoom(token, env.ROOM_SIGNING_KEY);
  if (!room || !await roomIsAvailable(room, env)) return deniedRoom();
  // The guest opening the invite is the second and last prewarm point. The
  // host dashboard's 15-second status poll is deliberately not one: it would
  // hold the GPU up for as long as a tab stays open.
  ctx.waitUntil(warmCompute(env));
  const headers = privateHeaders();
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(roomHtml, { headers });
}

async function roomIsAvailable(room: VerifiedRoom, env: Env): Promise<boolean> {
  const response = await env.ROOMS.get(env.ROOMS.idFromName(room.id)).fetch(
    new Request("https://room.internal/status", {
      headers: { "X-Room-Expires": String(room.expiresAt) }
    })
  );
  return response.status === 204;
}

async function authorizedRoom(
  request: Request, env: Env, allowBrowserGet = false
): Promise<VerifiedRoom | null> {
  if (!(allowBrowserGet ? sameOriginBrowserGet(request, env) : sameOrigin(request, env))) {
    return null;
  }
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  const room = token && !token.includes(" ")
    ? await verifyRoom(token, env.ROOM_SIGNING_KEY) : null;
  return room && await roomIsAvailable(room, env) ? room : null;
}

async function roomPreflight(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  if (!sameOriginBrowserGet(request, env)) return new Response("Forbidden", { status: 403 });
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length) : "";
  const room = token && !token.includes(" ")
    ? await verifyRoom(token, env.ROOM_SIGNING_KEY) : null;
  if (!room) {
    return new Response("Room expired or unavailable", {
      status: 401, headers: privateHeaders()
    });
  }
  if (!await roomIsAvailable(room, env)) {
    return new Response("Room expired or unavailable", {
      status: 410, headers: privateHeaders()
    });
  }
  return new Response(null, { status: 204, headers: privateHeaders() });
}

async function authorizedHostControl(
  request: Request, env: Env, allowBrowserGet = false
): Promise<VerifiedRoom | null> {
  if (!(allowBrowserGet ? sameOriginBrowserGet(request, env) : sameOrigin(request, env))) {
    return null;
  }
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token && !token.includes(" ") ? verifyHostControl(token, env.ROOM_SIGNING_KEY) : null;
}

async function hostRoomStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const room = await authorizedHostControl(request, env, true);
  if (!room) return new Response("Forbidden", { status: 403, headers: privateHeaders() });
  const response = await env.ROOMS.get(env.ROOMS.idFromName(room.id)).fetch(
    new Request("https://room.internal/host-status", {
      headers: { "X-Room-Expires": String(room.expiresAt) }
    })
  );
  return new Response(response.body, {
    status: response.status, headers: privateHeaders(response.headers)
  });
}

async function closeHostRoom(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const room = await authorizedHostControl(request, env);
  if (!room) return new Response("Forbidden", { status: 403, headers: privateHeaders() });
  const response = await env.ROOMS.get(env.ROOMS.idFromName(room.id)).fetch(
    new Request("https://room.internal/close", {
      method: "POST", headers: { "X-Room-Expires": String(room.expiresAt) }
    })
  );
  return new Response(response.body, {
    status: response.status, headers: privateHeaders(response.headers)
  });
}

// One Modal origin serves /tts, /translate and /health. Deriving the sibling
// paths from the configured TTS URL keeps them impossible to point apart.
function modalEndpoint(env: Env, path: string): URL | null {
  const url = httpsEndpoint(env.MODAL_TTS_URL);
  if (!url) return null;
  url.pathname = path;
  url.search = "";
  return url;
}

// GET /health starts the model preload on the GPU container. Calling it when a
// room is created or opened pays the cold start inside the share-and-join gap
// instead of on the first sentence somebody speaks.
async function warmCompute(env: Env): Promise<void> {
  const endpoint = modalEndpoint(env, "/health");
  if (!env.MODAL_SHARED_SECRET || !endpoint) return;
  const request = new Request(endpoint.toString(), {
    headers: { Authorization: `Bearer ${env.MODAL_SHARED_SECRET}` }
  });
  try {
    const response = env.MODAL_TEST
      ? await env.MODAL_TEST.fetch(request) : await fetch(request);
    await response.body?.cancel();
  } catch {
    // A prewarm that fails costs the next speaker a cold start, nothing else.
  }
}

function httpsEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function validatedAudioStream(
  stream: ReadableStream<Uint8Array> | null, expectedBytes: number
): Promise<ReadableStream<Uint8Array> | null> {
  if (!stream || expectedBytes <= 4 || expectedBytes > MAX_TTS_AUDIO_BYTES) return null;
  const reader = stream.getReader();
  const initial: Uint8Array[] = [];
  const prefix = new Uint8Array(4);
  let prefixBytes = 0;
  let received = 0;
  while (prefixBytes < prefix.byteLength) {
    const { value, done } = await reader.read();
    if (done || !value) {
      await reader.cancel().catch(() => {});
      return null;
    }
    received += value.byteLength;
    if (received > expectedBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    initial.push(value);
    const take = Math.min(value.byteLength, prefix.byteLength - prefixBytes);
    prefix.set(value.subarray(0, take), prefixBytes);
    prefixBytes += take;
  }
  if (new TextDecoder().decode(prefix) !== "RIFF") {
    await reader.cancel().catch(() => {});
    return null;
  }

  const output = new FixedLengthStream(expectedBytes);
  const writer = output.writable.getWriter();
  void (async () => {
    try {
      for (const chunk of initial) await writer.write(chunk);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > expectedBytes) throw new Error("upstream TTS exceeded declared length");
        await writer.write(value);
      }
      if (received !== expectedBytes) throw new Error("upstream TTS was truncated");
      await writer.close();
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      await writer.abort(error).catch(() => {});
    }
  })();
  return output.readable;
}

function contentLengthTooLarge(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get("Content-Length");
  if (!raw) return false;
  const value = Number(raw);
  return !Number.isSafeInteger(value) || value < 0 || value > maxBytes;
}

function validIceServers(value: unknown): IceServer[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return null;
  const output: IceServer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const rawUrls = typeof record.urls === "string" ? [record.urls] : record.urls;
    if (!Array.isArray(rawUrls) || rawUrls.length === 0 || rawUrls.length > 12
        || rawUrls.some(url => typeof url !== "string"
          || !/^(stun|turn|turns):/.test(url))) return null;
    // Cloudflare documents port 53 as browser-blocked. Trickle ICE tolerates
    // it, but omitting it avoids a needless timeout and keeps the config small.
    const urls = rawUrls.filter(url => !/:53(?:\?|$)/.test(url as string)) as string[];
    if (urls.length === 0) continue;
    const server: IceServer = { urls };
    if (typeof record.username === "string" && typeof record.credential === "string") {
      server.username = record.username;
      server.credential = record.credential;
    }
    output.push(server);
  }
  return output.length ? output : null;
}

async function turnCredentials(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const room = await authorizedRoom(request, env, true);
  if (!room) return new Response("Forbidden", { status: 403 });
  const ipLimited = await consumeIpQuota(
    request, env, "turn", TURN_IP_LIMIT, TURN_IP_WINDOW_MS
  );
  if (ipLimited) return ipLimited;
  const roomQuota = await env.ROOMS.get(env.ROOMS.idFromName(room.id)).fetch(
    new Request("https://room.internal/turn-quota", {
      method: "POST", headers: {"X-Room-Expires": String(room.expiresAt)}
    })
  );
  if (roomQuota.status !== 204) {
    const headers = privateHeaders();
    headers.set("Retry-After", roomQuota.headers.get("Retry-After") || "60");
    return new Response("TURN rate limit reached", {status: 429, headers});
  }
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
    return new Response("TURN is unavailable", { status: 503 });
  }
  const configured = Number(env.TURN_TTL_SECONDS || "3600");
  const ttl = Math.max(60, Math.min(TURN_TTL_MAX_SECONDS,
    Number.isSafeInteger(configured) ? configured : 3600));
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}`
    + "/credentials/generate-ice-servers";
  const upstreamRequest = new Request(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURN_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ttl })
  });
  const upstream = env.TURN_TEST
    ? await env.TURN_TEST.fetch(upstreamRequest)
    : await fetch(upstreamRequest);
  if (upstream.status !== 201) return new Response("TURN is unavailable", { status: 503 });
  let data: Record<string, unknown>;
  try { data = await upstream.json<Record<string, unknown>>(); }
  catch { return new Response("TURN is unavailable", { status: 503 }); }
  const iceServers = validIceServers(data.iceServers);
  if (!iceServers) return new Response("TURN is unavailable", { status: 503 });
  return Response.json({
    iceServers,
    expires_at: Math.floor(Date.now() / 1000) + ttl
  }, { headers: privateHeaders() });
}

async function abuseReport(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", {status: 405});
  const room = await authorizedRoom(request, env);
  if (!room) return new Response("Forbidden", {status: 403, headers: privateHeaders()});
  if (contentLengthTooLarge(request, 512)) {
    return new Response("Request body is too large", {status: 413, headers: privateHeaders()});
  }
  const raw = await readLimited(request.body, 512);
  if (!raw) return new Response("Request body is too large", {status: 413, headers: privateHeaders()});
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    data = parsed as Record<string, unknown>;
  } catch {
    return Response.json({error: "invalid JSON"}, {status: 400, headers: privateHeaders()});
  }
  if (Object.keys(data).sort().join(",") !== "category,platform"
      || typeof data.category !== "string" || !REPORT_CATEGORIES.has(data.category)
      || typeof data.platform !== "string" || !REPORT_PLATFORMS.has(data.platform)) {
    return Response.json({error: "invalid report"}, {status: 422, headers: privateHeaders()});
  }
  const participantId = request.headers.get("X-Participant-ID") || "";
  if (!/^[A-Za-z0-9_-]{16}$/.test(participantId)) {
    return new Response("Forbidden", {status: 403, headers: privateHeaders()});
  }
  const roomStub = env.ROOMS.get(env.ROOMS.idFromName(room.id));
  const quota = await roomStub.fetch(
    new Request("https://room.internal/report-quota", {
      method: "POST",
      headers: {"X-Room-Expires": String(room.expiresAt), "X-Participant-ID": participantId}
    })
  );
  if (quota.status !== 204) {
    const status = quota.status === 409 ? 409 : quota.status === 429 ? 429 : 403;
    const headers = privateHeaders();
    if (status === 429) headers.set("Retry-After", quota.headers.get("Retry-After") || "3600");
    return new Response(status === 409 ? "Report already received"
      : status === 429 ? "Rate limit reached" : "Forbidden", {
      status, headers
    });
  }
  const rollbackReservation = async (): Promise<void> => {
    try {
      await roomStub.fetch(new Request("https://room.internal/report-rollback", {
        method: "POST",
        headers: {"X-Room-Expires": String(room.expiresAt), "X-Participant-ID": participantId}
      }));
    } catch { /* keep the request failed closed */ }
  };
  const ipLimited = await consumeIpQuota(
    request, env, "report", REPORT_IP_LIMIT, REPORT_IP_WINDOW_MS
  );
  if (ipLimited) {
    await rollbackReservation();
    return ipLimited;
  }
  const roomRef = await opaqueDigest(room.id, 16);
  const submissionId = await opaqueDigest(`${room.id}:${participantId}`, 22);
  let stored: Response | null = null;
  try {
    const reportRequest = new Request("https://reports.internal/", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        category: data.category, platform: data.platform, room_ref: roomRef,
        submission_id: submissionId, room_id: room.id, room_expires: room.expiresAt
      })
    });
    stored = env.REPORTS_TEST && request.headers.get("X-Test-Report-Failure") === "1"
      ? await env.REPORTS_TEST.fetch(reportRequest)
      : await env.REPORTS.get(env.REPORTS.idFromName("global")).fetch(reportRequest);
  } catch { /* rollback below */ }
  if (!stored?.ok) {
    await rollbackReservation();
    return new Response("Report service unavailable", {status: 503, headers: privateHeaders()});
  }
  return Response.json({status: "received"}, {status: 201, headers: privateHeaders()});
}

function secretEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function reportInbox(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const closeMatch = url.pathname.match(/^\/api\/internal\/reports\/([A-Za-z0-9_-]{22})\/close$/);
  if (!(request.method === "GET" && url.pathname === "/api/internal/reports")
      && !(request.method === "POST" && closeMatch)) {
    return new Response("Method Not Allowed", {status: 405});
  }
  const secret = env.MOBILE_REPORT_ADMIN_TOKEN || "";
  if (secret.length < 32) {
    return new Response("Report administration unavailable", {status: 503, headers: privateHeaders()});
  }
  const authorization = request.headers.get("Authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secretEquals(provided, secret)) {
    return new Response("Forbidden", {status: 403, headers: privateHeaders()});
  }
  const reports = env.REPORTS.get(env.REPORTS.idFromName("global"));
  if (!closeMatch) {
    const response = await reports.fetch(new Request("https://reports.internal/"));
    return new Response(response.body, {
      status: response.status, headers: privateHeaders(response.headers)
    });
  }
  const resolved = await reports.fetch(
    new Request(`https://reports.internal/resolve/${closeMatch[1]}`)
  );
  if (resolved.status === 404) return new Response("Report not found", {status: 404});
  if (!resolved.ok) return new Response("Report administration unavailable", {status: 503});
  const target = await resolved.json<{room_id?: unknown; room_expires?: unknown}>();
  if (typeof target.room_id !== "string" || !/^[A-Za-z0-9_-]{24}$/.test(target.room_id)
      || !Number.isSafeInteger(target.room_expires)) {
    return new Response("Report administration unavailable", {status: 503});
  }
  const closed = await env.ROOMS.get(env.ROOMS.idFromName(target.room_id)).fetch(
    new Request("https://room.internal/close", {
      method: "POST", headers: {"X-Room-Expires": String(target.room_expires)}
    })
  );
  if (!closed.ok) return new Response("Room is no longer available", {status: 410});
  return Response.json({state: "closed"}, {headers: privateHeaders()});
}

async function translatedVoice(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const room = await authorizedRoom(request, env);
  if (!room) return new Response("Forbidden", { status: 403 });
  const ttsEndpoint = httpsEndpoint(env.MODAL_TTS_URL);
  if (!env.MODAL_SHARED_SECRET || !ttsEndpoint) {
    return new Response("Translated voice is unavailable", { status: 503 });
  }
  if (contentLengthTooLarge(request, MAX_TTS_BODY_BYTES)) {
    return new Response("Request body is too large", { status: 413 });
  }
  const body = await readLimited(request.body, MAX_TTS_BODY_BYTES);
  if (!body) return new Response("Request body is too large", { status: 413 });
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    data = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400, headers: privateHeaders() });
  }
  const locale = localeProfile(data.locale);
  const selectedVoice = locale ? voiceProfile(data.voice_profile, locale.id) : null;
  if (typeof data.text !== "string" || data.text.length === 0
      || data.text.length > MAX_TTS_CHARS || !locale || !selectedVoice) {
    return Response.json({ error: "invalid translated voice request" }, {
      status: 422, headers: privateHeaders()
    });
  }
  const participantId = request.headers.get("X-Participant-ID") || "";
  if (!/^[A-Za-z0-9_-]{16}$/.test(participantId)) {
    return new Response("Forbidden", { status: 403, headers: privateHeaders() });
  }
  const quotaHeaders = new Headers({
    "X-Room-Expires": String(room.expiresAt),
    "X-Participant-ID": participantId,
    "X-Target-Locale": locale.id,
    "X-Voice-Profile": selectedVoice.id,
  });
  const quota = await env.ROOMS.get(env.ROOMS.idFromName(room.id)).fetch(
    new Request("https://room.internal/tts-quota", {
      method: "POST", headers: quotaHeaders
    }));
  if (quota.status !== 204) {
    const headers = privateHeaders();
    const retryAfter = quota.headers.get("Retry-After");
    if (retryAfter) headers.set("Retry-After", retryAfter);
    return new Response(quota.status === 429 ? "Translated voice rate limit reached" : "Forbidden", {
      status: quota.status === 429 ? 429 : 403,
      headers
    });
  }
  const upstreamRequest = new Request(ttsEndpoint.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MODAL_SHARED_SECRET}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: data.text,
      voice_profile: selectedVoice.id,
    })
  });
  const upstream = env.MODAL_TEST
    ? await env.MODAL_TEST.fetch(upstreamRequest)
    : await fetch(upstreamRequest);
  if (!upstream.ok || !upstream.headers.get("Content-Type")?.startsWith("audio/wav")) {
    return new Response("Translated voice is unavailable", { status: 503 });
  }
  const rawAudioLength = upstream.headers.get("Content-Length");
  const audioLength = Number(rawAudioLength);
  if (!rawAudioLength || !Number.isSafeInteger(audioLength)
      || audioLength <= 4 || audioLength > MAX_TTS_AUDIO_BYTES) {
    return new Response("Translated voice is unavailable", { status: 503 });
  }
  const audio = await validatedAudioStream(upstream.body, audioLength);
  if (!audio) {
    return new Response("Translated voice is unavailable", { status: 503 });
  }
  const headers = privateHeaders();
  headers.set("Content-Type", "audio/wav");
  return new Response(audio, { headers });
}

type OAuthProvider = {
  id: string;
  authorize: string;
  token: string;
  clientId: string;
  scope: string;
  authorizeParams: Record<string, string>;
  // An OIDC provider answers with an id_token; Facebook answers with an access
  // token that only its Graph profile endpoint can turn into an identity.
  issuers: string[] | null;
  profile: string | null;
  secret: (env: Env) => Promise<string>;
};

type OAuthIdentity = { sub: string; name: string; email: string };

function pkcs8Bytes(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function appleClientSecret(env: Env): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({
    alg: "ES256", kid: env.APPLE_KEY_ID, typ: "JWT"
  })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: env.MOBILE_APPLE_TEAM_ID, iat: issuedAt, exp: issuedAt + OAUTH_STATE_TTL_SECONDS,
    aud: "https://appleid.apple.com", sub: env.APPLE_CLIENT_ID
  })));
  const key = await crypto.subtle.importKey(
    "pkcs8", pkcs8Bytes(env.APPLE_PRIVATE_KEY || "").buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  // WebCrypto returns ECDSA signatures as raw r‖s, which is exactly the JWS
  // ES256 encoding. Nothing here needs to unwrap DER; doing so would break it.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

// A provider exists only when its credentials do. An unprovisioned button is
// worse than a missing one, so /auth/<p>/start 404s until the operator sets it.
function oauthProviders(env: Env): Map<string, OAuthProvider> {
  const providers = new Map<string, OAuthProvider>();
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.set("google", {
      id: "google",
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      clientId: env.GOOGLE_CLIENT_ID,
      scope: "openid email profile",
      authorizeParams: { prompt: "select_account" },
      issuers: ["https://accounts.google.com", "accounts.google.com"],
      profile: null,
      secret: async () => env.GOOGLE_CLIENT_SECRET || "",
    });
  }
  if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
    providers.set("facebook", {
      id: "facebook",
      authorize: "https://www.facebook.com/v21.0/dialog/oauth",
      token: "https://graph.facebook.com/v21.0/oauth/access_token",
      clientId: env.FACEBOOK_APP_ID,
      scope: "email",
      authorizeParams: {},
      issuers: null,
      profile: "https://graph.facebook.com/v21.0/me?fields=id,name,email",
      secret: async () => env.FACEBOOK_APP_SECRET || "",
    });
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
      && env.MOBILE_APPLE_TEAM_ID) {
    providers.set("apple", {
      id: "apple",
      authorize: "https://appleid.apple.com/auth/authorize",
      token: "https://appleid.apple.com/auth/token",
      clientId: env.APPLE_CLIENT_ID,
      scope: "name email",
      // "name email" is only granted with form_post, which is a cross-site POST.
      authorizeParams: { response_mode: "form_post" },
      issuers: ["https://appleid.apple.com"],
      profile: null,
      secret: appleClientSecret,
    });
  }
  return providers;
}

async function providerFetch(env: Env, request: Request): Promise<Response> {
  return env.OAUTH_TEST ? env.OAUTH_TEST.fetch(request) : fetch(request);
}

function oauthRedirectUri(env: Env, providerId: string): string {
  return `${env.PUBLIC_ORIGIN}/auth/${providerId}/callback`;
}

function clearStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/auth; Max-Age=0`;
}

// Every failure - forged state, dead provider, malformed token - lands here.
// The browser learns that sign-in failed and nothing else.
function authFailed(): Response {
  const headers = privateHeaders();
  headers.set("Location", "/?auth=failed");
  headers.append("Set-Cookie", clearStateCookie());
  return new Response(null, { status: 302, headers });
}

function authStart(request: Request, env: Env, providerId: string): Response {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  // redirect_uri must be pinned to one origin the provider console knows.
  if (!env.PUBLIC_ORIGIN) {
    return new Response("Sign-in is not configured", {
      status: 503, headers: privateHeaders()
    });
  }
  const provider = oauthProviders(env).get(providerId);
  if (!provider) return new Response("Unknown sign-in provider", {
    status: 404, headers: privateHeaders()
  });
  const state = base64url(crypto.getRandomValues(new Uint8Array(18)));
  const url = new URL(provider.authorize);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", oauthRedirectUri(env, providerId));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scope);
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(provider.authorizeParams)) {
    url.searchParams.set(key, value);
  }
  const headers = privateHeaders();
  headers.set("Location", url.toString());
  // SameSite=None, not Lax: Apple's form_post callback is a cross-site POST and
  // a Lax cookie is not sent with it, which would fail every Apple sign-in as
  // "state mismatch". Secure is mandatory alongside None. The session cookie
  // itself stays Lax - only this 10-minute, single-purpose cookie is None.
  headers.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=${providerId}.${state};`
    + ` HttpOnly; Secure; SameSite=None; Path=/auth; Max-Age=${OAUTH_STATE_TTL_SECONDS}`);
  return new Response(null, { status: 302, headers });
}

function oauthIdentity(claims: Record<string, unknown>, provider: OAuthProvider): OAuthIdentity | null {
  // The id_token came back on our own TLS call to the provider's token
  // endpoint, so its signature is redundant here (OIDC Core 3.1.3.7). Issuer,
  // audience and expiry are not: they are what makes a token from another
  // client or another provider unusable.
  // ponytail: the day an id_token reaches this worker any other way - a native
  // client posting one, an implicit flow, a token relayed by the app - this
  // shortcut is void and JWKS signature verification becomes mandatory.
  if (typeof claims.iss !== "string" || !provider.issuers?.includes(claims.iss)) return null;
  if (claims.aud !== provider.clientId) return null;
  const expires = Number(claims.exp);
  if (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000)) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  const email = typeof claims.email === "string" ? claims.email : "";
  return { sub: claims.sub, name: typeof claims.name === "string" ? claims.name : email, email };
}

function decodeIdToken(idToken: unknown, provider: OAuthProvider): OAuthIdentity | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as unknown;
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    return oauthIdentity(claims as Record<string, unknown>, provider);
  } catch {
    return null;
  }
}

async function graphIdentity(
  env: Env, provider: OAuthProvider, accessToken: unknown
): Promise<OAuthIdentity | null> {
  if (typeof accessToken !== "string" || !accessToken || !provider.profile) return null;
  const response = await providerFetch(env, new Request(provider.profile, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }));
  if (!response.ok) return null;
  const data = await response.json<Record<string, unknown>>();
  if (typeof data.id !== "string" || !data.id) return null;
  const email = typeof data.email === "string" ? data.email : "";
  return { sub: data.id, name: typeof data.name === "string" ? data.name : email, email };
}

async function authCallback(
  request: Request, env: Env, providerId: string
): Promise<Response> {
  const provider = oauthProviders(env).get(providerId);
  if (!provider || !env.PUBLIC_ORIGIN
      || !signingSecretIsValid(env.ROOM_SIGNING_KEY)) return authFailed();
  const formPost = provider.authorizeParams.response_mode === "form_post";
  if (request.method !== "GET" && !(request.method === "POST" && formPost)) {
    return new Response("Method Not Allowed", { status: 405 });
  }
  let code = "";
  let state = "";
  if (request.method === "POST") {
    if (contentLengthTooLarge(request, OAUTH_CALLBACK_BODY_BYTES)) return authFailed();
    const raw = await readLimited(request.body, OAUTH_CALLBACK_BODY_BYTES);
    if (!raw) return authFailed();
    const form = new URLSearchParams(new TextDecoder().decode(raw));
    code = form.get("code") || "";
    state = form.get("state") || "";
  } else {
    const url = new URL(request.url);
    code = url.searchParams.get("code") || "";
    state = url.searchParams.get("state") || "";
  }
  // The state cookie names its provider too: a state minted for one provider
  // cannot be spent on another's callback.
  const presented = readCookie(request, OAUTH_STATE_COOKIE) || "";
  if (!code || !state || !secretEquals(presented, `${providerId}.${state}`)) return authFailed();

  try {
    const exchange = await providerFetch(env, new Request(provider.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: oauthRedirectUri(env, providerId),
        client_id: provider.clientId,
        client_secret: await provider.secret(env),
      }).toString()
    }));
    if (!exchange.ok) return authFailed();
    const tokens = await exchange.json<Record<string, unknown>>();
    const identity = provider.issuers
      ? decodeIdToken(tokens.id_token, provider)
      : await graphIdentity(env, provider, tokens.access_token);
    if (!identity) return authFailed();
    // The provider's subject is hashed away immediately: what the account is
    // keyed by is derived from it and cannot be turned back into it.
    const userId = await opaqueDigest(`${providerId}:${identity.sub}`, 22);
    const stored = await env.USERS.get(env.USERS.idFromName(userId)).fetch(
      new Request("https://users.internal/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId, provider: providerId,
          name: identity.name, email: identity.email
        })
      })
    );
    if (!stored.ok) return authFailed();
    const session = await signSession(
      userId, Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, env.ROOM_SIGNING_KEY
    );
    const headers = privateHeaders();
    headers.set("Location", "/");
    headers.append("Set-Cookie", sessionCookie(session));
    headers.append("Set-Cookie", clearStateCookie());
    return new Response(null, { status: 302, headers });
  } catch {
    return authFailed();
  }
}

function authLogout(request: Request, env: Env): Response {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!sameOrigin(request, env)) return new Response("Forbidden", { status: 403 });
  const headers = privateHeaders();
  headers.append("Set-Cookie", clearSessionCookie());
  return new Response(null, { status: 204, headers });
}

async function accountSnapshot(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  // The signed-out answer still lists providers: the page renders its sign-in
  // buttons from exactly what this worker has credentials for.
  const providers = [...oauthProviders(env).keys()];
  const userId = await sessionUser(request, env);
  const snapshot = userId ? await env.USERS.get(env.USERS.idFromName(userId)).fetch(
    new Request("https://users.internal/")
  ) : null;
  if (!snapshot?.ok) {
    const headers = privateHeaders();
    // A session whose account is gone is a session that should stop existing.
    if (userId) headers.append("Set-Cookie", clearSessionCookie());
    return Response.json({ signed_in: false, providers }, { headers });
  }
  const account = await snapshot.json<Record<string, unknown>>();
  return Response.json({ signed_in: true, providers, ...account }, {
    headers: privateHeaders()
  });
}

async function accountDelete(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!sameOrigin(request, env)) return new Response("Forbidden", { status: 403 });
  const userId = await sessionUser(request, env);
  if (!userId) return new Response("Sign in required", {
    status: 401, headers: privateHeaders()
  });
  const deleted = await env.USERS.get(env.USERS.idFromName(userId)).fetch(
    new Request("https://users.internal/", { method: "DELETE" })
  );
  if (!deleted.ok) return new Response("Account service unavailable", {
    status: 503, headers: privateHeaders()
  });
  const headers = privateHeaders();
  headers.append("Set-Cookie", clearSessionCookie());
  return new Response(null, { status: 204, headers });
}

export class Room extends DurableObject<Env> {
  // Ordinary memory is deliberately disposable. An active outbound Modal
  // socket keeps this object awake; after hibernation or process replacement,
  // the next PCM frame creates only that participant's compute stream again.
  private compute = new Map<string, ComputeState>();
  private pcmBudgets = new Map<string, PcmBudget>();

  private attachment(socket: WebSocket): ParticipantAttachment | null {
    const value = socket.deserializeAttachment() as Partial<ParticipantAttachment> | null;
    if (!value || value.kind !== "browser" || typeof value.id !== "string"
        || !/^[A-Za-z0-9_-]{16}$/.test(value.id)
        || typeof value.joined !== "boolean" || typeof value.locale !== "string"
        || typeof value.lang !== "string" || typeof value.name !== "string"
        || (value.voiceProfileId !== null && typeof value.voiceProfileId !== "string")
        || !Number.isFinite(value.lastSeenAt) || !Number.isFinite(value.ttsWindowStart)
        || typeof value.ttsCount !== "number" || !Number.isSafeInteger(value.ttsCount)
        || value.ttsCount < 0) return null;
    if (value.joined) {
      const locale = localeProfile(value.locale);
      const selected = value.voiceProfileId === null ? null
        : voiceProfile(value.voiceProfileId, value.locale);
      if (!locale || !isJoinableLocale(value.locale) || locale.language !== value.lang
          || (value.voiceProfileId === null && locale.voice_profiles.length > 0)
          || (value.voiceProfileId !== null && !selected)) return null;
    }
    return value as ParticipantAttachment;
  }

  private participants(): Array<{ socket: WebSocket; meta: ParticipantAttachment }> {
    return this.ctx.getWebSockets("browser").flatMap(socket => {
      const meta = this.attachment(socket);
      return meta?.joined ? [{ socket, meta }] : [];
    });
  }

  private publicParticipant(meta: ParticipantAttachment) {
    return {
      id: meta.id,
      locale: meta.locale,
      lang: meta.lang,
      name: meta.name,
      voice_profile: meta.voiceProfileId,
    };
  }

  private computeRoute(meta: ParticipantAttachment): ComputeRoute {
    const targetLanguages = [...new Set(this.participants()
      .filter(({ meta: listener }) => listener.id !== meta.id && listener.lang !== meta.lang)
      .map(({ meta: listener }) => listener.lang))].sort();
    return {
      sourceLocale: meta.locale,
      sourceLanguage: meta.lang,
      targetLanguages: targetLanguages.slice(0, MAX_PARTICIPANTS - 1),
    };
  }

  private resolveLocaleVoice(
    localeId: unknown, requestedVoice: unknown,
  ): LocaleVoiceSelection {
    const locale = localeProfile(localeId);
    if (!locale || !isJoinableLocale(localeId)) return { reason: "unsupported locale" };
    if (requestedVoice !== null && typeof requestedVoice !== "string") {
      return { reason: "unsupported voice profile" };
    }
    const voice = requestedVoice === null ? null : voiceProfile(requestedVoice, locale.id);
    if ((requestedVoice === null && locale.voice_profiles.length)
        || (typeof requestedVoice === "string" && !voice)) {
      return { reason: "unsupported voice profile" };
    }
    return { locale, voice };
  }

  private refreshComputeRoutes(): void {
    // A peer locale change changes the target set for every active speaker in
    // this one room.  Closing only the changed peer would leak a stale route.
    for (const { meta } of this.participants()) {
      if (meta.joined) this.closeCompute(meta.id);
    }
  }

  private send(socket: WebSocket, message: object): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, "send failed");
    }
  }

  private broadcast(message: object, exclude?: WebSocket): void {
    for (const { socket } of this.participants()) {
      if (socket !== exclude) this.send(socket, message);
    }
  }

  private closeRoom(): void {
    // Mark every attachment first. Close callbacks then cannot broadcast stale
    // presence after the terminal message, and no compute stream survives a
    // host revocation.
    for (const socket of this.ctx.getWebSockets("browser")) {
      const meta = this.attachment(socket);
      if (meta) {
        meta.joined = false;
        socket.serializeAttachment(meta);
        this.closeCompute(meta.id);
        this.pcmBudgets.delete(meta.id);
      }
    }
    for (const id of [...this.compute.keys()]) this.closeCompute(id);
    this.pcmBudgets.clear();
    for (const socket of this.ctx.getWebSockets("browser")) {
      this.send(socket, { type: "room_closed" });
      try { socket.close(ROOM_CLOSED_CLOSE_CODE, "room closed"); } catch { /* already closed */ }
    }
  }

  private removeParticipant(
    socket: WebSocket,
    meta: ParticipantAttachment,
    reason: string,
    closeSocket: boolean
  ): void {
    if (!meta.joined) return;
    meta.joined = false;
    socket.serializeAttachment(meta);
    this.closeCompute(meta.id);
    this.pcmBudgets.delete(meta.id);
    this.broadcast({
      type: "peer_leave",
      id: meta.id,
      participant_count: this.participants().length,
      participant_limit: MAX_PARTICIPANTS
    }, socket);
    this.refreshComputeRoutes();
    // Last participant out banks the call. waitUntil keeps the leave broadcast
    // off the storage round trip; the object stays alive until it settles.
    if (!this.participants().length) this.ctx.waitUntil(this.flushUsage());
    if (closeSocket) {
      try { socket.close(1000, reason.slice(0, 120)); } catch { /* already closed */ }
    }
  }

  private sweepExpiredSockets(now: number): void {
    const expired = this.ctx.getWebSockets("browser").flatMap(socket => {
      const meta = this.attachment(socket);
      return meta && (!Number.isFinite(meta.lastSeenAt)
        || now - meta.lastSeenAt >= PRESENCE_LEASE_MS)
        ? [{ socket, meta, wasJoined: meta.joined }] : [];
    });
    if (!expired.length) return;

    // Mark the whole expired set first so every leave event reports the same
    // final, accurate count and close callbacks cannot broadcast duplicates.
    for (const { socket, meta, wasJoined } of expired) {
      if (wasJoined) {
        meta.joined = false;
        socket.serializeAttachment(meta);
        this.closeCompute(meta.id);
        this.pcmBudgets.delete(meta.id);
      }
    }
    const participantCount = this.participants().length;
    for (const { socket, meta, wasJoined } of expired) {
      if (wasJoined) {
        this.broadcast({
          type: "peer_leave",
          id: meta.id,
          participant_count: participantCount,
          participant_limit: MAX_PARTICIPANTS
        }, socket);
      }
      try { socket.close(1000, "presence lease expired"); } catch { /* already closed */ }
    }
    this.refreshComputeRoutes();
    if (!participantCount) this.ctx.waitUntil(this.flushUsage());
  }

  private leasedSocketCount(now: number): number {
    return this.ctx.getWebSockets("browser").filter(socket => {
      const meta = this.attachment(socket);
      // Missing attachment state is invalid and must still consume capacity.
      return !meta || (Number.isFinite(meta.lastSeenAt)
        && now - meta.lastSeenAt < PRESENCE_LEASE_MS);
    }).length;
  }

  private policyClose(socket: WebSocket, reason: string): void {
    socket.close(1008, reason.slice(0, 120));
  }

  private computeState(id: string): ComputeState {
    let state = this.compute.get(id);
    if (!state) {
      state = {
        socket: null, connecting: null, failures: 0, nextAttempt: 0,
        generation: 0, abort: null
      };
      this.compute.set(id, state);
    }
    return state;
  }

  private markComputeClosed(id: string, socket: WebSocket): void {
    const state = this.compute.get(id);
    if (!state || state.socket !== socket) return;
    state.socket = null;
    state.failures += 1;
    const delay = Math.min(
      COMPUTE_BACKOFF_MAX_MS,
      250 * 2 ** Math.min(state.failures, 5)
    );
    state.nextAttempt = Date.now() + delay;
  }

  private reportComputeCapacity(
    participantId: string, state: ComputeState, generation: number,
    retryAfterMs: number,
  ): void {
    if (this.compute.get(participantId) !== state || state.generation !== generation) return;
    const participant = this.participants().find(({ meta }) => meta.id === participantId);
    if (!participant) return;
    this.send(participant.socket, {
      type: "caption_status", status: "capacity", scope: "global",
      retry_after_ms: retryAfterMs,
    });
  }

  private closeCompute(id: string): void {
    const state = this.compute.get(id);
    this.compute.delete(id);
    if (state) {
      state.generation += 1;
      state.abort?.abort();
      state.abort = null;
    }
    if (state?.socket) {
      try { state.socket.close(1000, "participant stream ended"); } catch { /* closed */ }
    }
  }

  private consumePcm(id: string, bytes: number): boolean {
    const now = Date.now();
    const budget = this.pcmBudgets.get(id) || { tokens: PCM_BURST_BYTES, updatedAt: now };
    budget.tokens = Math.min(
      PCM_BURST_BYTES,
      budget.tokens + (now - budget.updatedAt) * PCM_RATE_BYTES_PER_SECOND / 1000
    );
    budget.updatedAt = now;
    if (budget.tokens < bytes) {
      this.pcmBudgets.set(id, budget);
      return false;
    }
    budget.tokens -= bytes;
    this.pcmBudgets.set(id, budget);
    return true;
  }

  private consumeTts(
    participantId: string, locale: string, voiceProfileId: string,
  ): { allowed: boolean; retryAfter: number } {
    this.sweepExpiredSockets(Date.now());
    const participants = this.participants();
    const requesting = participants.find(({ meta }) => meta.id === participantId);
    if (!requesting || requesting.meta.locale !== locale
        || requesting.meta.voiceProfileId !== voiceProfileId) {
      return { allowed: false, retryAfter: 0 };
    }
    const now = Date.now();
    const newest = participants.reduce((current, { meta }) =>
      meta.ttsWindowStart > current.ttsWindowStart ? meta : current,
    participants[0].meta);
    let windowStart = newest.ttsWindowStart || now;
    let count = newest.ttsCount || 0;
    if (now - windowStart >= TTS_WINDOW_MS) {
      windowStart = now;
      count = 0;
    }
    if (count >= TTS_REQUESTS_PER_WINDOW) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((windowStart + TTS_WINDOW_MS - now) / 1000))
      };
    }
    count += 1;
    for (const { socket, meta } of participants) {
      meta.ttsWindowStart = windowStart;
      meta.ttsCount = count;
      socket.serializeAttachment(meta);
    }
    return { allowed: true, retryAfter: 0 };
  }

  private async reserveReport(participantId: string): Promise<number> {
    this.sweepExpiredSockets(Date.now());
    const participant = this.participants().find(({meta}) => meta.id === participantId);
    if (!participant) return 403;
    if (participant.meta.reported) return 409;
    const count = await this.ctx.storage.get<number>("reportCount") || 0;
    if (count >= REPORT_ROOM_LIMIT) return 429;
    participant.meta.reported = true;
    participant.socket.serializeAttachment(participant.meta);
    await this.ctx.storage.put("reportCount", count + 1);
    return 204;
  }

  private async rollbackReport(participantId: string): Promise<void> {
    const participant = this.participants().find(({meta}) => meta.id === participantId);
    if (participant?.meta.reported) {
      participant.meta.reported = false;
      participant.socket.serializeAttachment(participant.meta);
    }
    const count = await this.ctx.storage.get<number>("reportCount") || 0;
    if (count > 1) await this.ctx.storage.put("reportCount", count - 1);
    else if (count === 1) await this.ctx.storage.delete("reportCount");
  }

  private async consumeStoredQuota(
    key: string, limit: number, windowMs: number,
  ): Promise<{allowed: boolean; retryAfter: number}> {
    const now = Date.now();
    const state = await this.ctx.storage.get<{windowStart: number; count: number}>(key);
    const current = !state || now - state.windowStart >= windowMs
      ? {windowStart: now, count: 0} : state;
    if (current.count >= limit) {
      return {allowed: false, retryAfter: Math.max(
        1, Math.ceil((current.windowStart + windowMs - now) / 1000)
      )};
    }
    current.count += 1;
    await this.ctx.storage.put(key, current);
    return {allowed: true, retryAfter: 0};
  }

  // Metering accumulates here and leaves once, at the end of the call. A
  // per-event DO-to-DO write would put another hop on the live audio path.
  private async bumpUsage(kind: "call" | "chat" | "tts", units: number): Promise<void> {
    if (units <= 0) return;
    const usage = await this.ctx.storage.get<RoomUsage>("usage") || {...EMPTY_USAGE};
    if (kind === "call") usage.callMs += units; else usage[kind] += units;
    await this.ctx.storage.put("usage", usage);
  }

  // Wall-clock room-active time: the meter starts when the room stops being
  // empty and banks when it is empty again.
  private async settleCall(): Promise<void> {
    if (this.participants().length) return;
    const activeSince = await this.ctx.storage.get<number>("activeSince");
    if (activeSince === undefined) return;
    await this.ctx.storage.delete("activeSince");
    await this.bumpUsage("call", Math.max(0, Date.now() - activeSince));
  }

  private async flushUsage(): Promise<void> {
    await this.settleCall();
    const owner = await this.ctx.storage.get<string>("owner");
    const usage = await this.ctx.storage.get<RoomUsage>("usage");
    if (!owner || !usage) return;
    await this.ctx.storage.put("usage", {...EMPTY_USAGE});
    // The room's own id never leaves: the account sees a one-way digest of it,
    // so a usage row can be counted but never turned back into an invite.
    const roomRef = await opaqueDigest(this.ctx.id.name || "", 16);
    const stub = this.env.USERS.get(this.env.USERS.idFromName(owner));
    const counted: [string, number][] = [
      // Part minutes round up, the way a call is billed.
      ["call", usage.callMs > 0 ? Math.ceil(usage.callMs / 60_000) : 0],
      ["chat", usage.chat],
      ["tts", usage.tts],
    ];
    for (const [kind, units] of counted) {
      if (units <= 0) continue;
      // A 404 here is a deleted account. The write is dropped, never retried:
      // metering must not resurrect a profile its owner erased.
      await stub.fetch(new Request("https://users.internal/usage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, units, room_ref: roomRef })
      })).catch(() => { /* usage is best-effort; the call already happened */ });
    }
  }

  private async computeFetch(request: Request): Promise<Response> {
    return this.env.MODAL_TEST ? this.env.MODAL_TEST.fetch(request) : fetch(request);
  }

  // Typed chat is the caption path without the microphone: one bounded POST
  // per message, and never a reason for a message not to arrive.
  private async translateChat(
    text: string, route: ComputeRoute,
  ): Promise<Record<string, string>> {
    const endpoint = modalEndpoint(this.env, "/translate");
    if (!this.env.MODAL_SHARED_SECRET || !endpoint) return {};
    try {
      const response = await this.computeFetch(new Request(endpoint.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.MODAL_SHARED_SECRET}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text, source_lang: route.sourceLanguage, target_langs: route.targetLanguages
        }),
        signal: AbortSignal.timeout(CHAT_TRANSLATE_TIMEOUT_MS)
      }));
      if (!response.ok) return {};
      const body = await response.json<{ translations?: Record<string, unknown> }>();
      const translations: Record<string, string> = {};
      for (const lang of route.targetLanguages) {
        const value = body.translations?.[lang];
        if (typeof value === "string" && value.length <= MAX_CAPTION_CHARS) {
          translations[lang] = value;
        }
      }
      return translations;
    } catch {
      // Fail open: a slow or broken GPU costs the translation, not the message.
      return {};
    }
  }

  private async relayChat(
    socket: WebSocket, meta: ParticipantAttachment, data: Record<string, unknown>,
  ): Promise<void> {
    if (typeof data.text !== "string" || data.text.length > MAX_CHAT_CHARS
        || !Number.isSafeInteger(data.cid) || (data.cid as number) < 0
        || (data.cid as number) >= CHAT_SEQ_BASE) {
      return this.policyClose(socket, "invalid chat message");
    }
    const text = data.text.trim();
    if (!text) return;
    const quota = await this.consumeStoredQuota(
      "chatQuota", CHAT_MESSAGES_PER_WINDOW, CHAT_WINDOW_MS
    );
    // Same answer the speech path gives a flooding socket: the connection is
    // closed rather than the room being asked to absorb it.
    if (!quota.allowed) return this.policyClose(socket, "chat rate exceeded");
    const started = Date.now();
    const route = this.computeRoute(meta);
    // A single-language room has nothing to translate into, so it costs the
    // GPU nothing at all.
    const translations = route.targetLanguages.length
      ? await this.translateChat(text, route) : {};
    this.broadcast({
      type: "chat",
      // Attribution and thread position are the server's, exactly as they are
      // for a caption: the client owns only its own draft counter.
      speaker: meta.id,
      speaker_lang: meta.lang,
      seq: CHAT_SEQ_BASE + (data.cid as number),
      final: true,
      original: text,
      translations,
      t_ms: Date.now() - started
    });
    await this.bumpUsage("chat", 1);
  }

  private onComputeMessage(
    participantId: string, state: ComputeState, generation: number,
    socket: WebSocket, raw: unknown,
  ): void {
    if (typeof raw !== "string") {
      try { socket.close(1008, "text compute messages required"); } catch { /* closed */ }
      return;
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_COMPUTE_MESSAGE_BYTES) return;
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      data = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (data.type === "stream_status" && data.status === "capacity"
        && data.scope === "global" && Number.isInteger(data.retry_after_ms)
        && (data.retry_after_ms as number) >= 250
        && (data.retry_after_ms as number) <= COMPUTE_BACKOFF_MAX_MS) {
      this.reportComputeCapacity(participantId, state, generation,
        data.retry_after_ms as number);
      return;
    }
    this.onComputeCaption(participantId, state, generation, socket, raw);
  }

  private async ensureCompute(meta: ParticipantAttachment): Promise<WebSocket | null> {
    const state = this.computeState(meta.id);
    if (state.socket?.readyState === 1) return state.socket;
    if (state.connecting) return state.connecting;
    if (Date.now() < state.nextAttempt) return null;
    const endpoint = httpsEndpoint(this.env.MODAL_WS_URL);
    if (!this.env.MODAL_SHARED_SECRET || !endpoint) return null;
    const generation = state.generation;
    const route = this.computeRoute(meta);
    const controller = new AbortController();
    state.abort = controller;

    state.connecting = (async () => {
      try {
        const headers = new Headers({
          Authorization: `Bearer ${this.env.MODAL_SHARED_SECRET}`,
          Upgrade: "websocket"
        });
        const response = await this.computeFetch(new Request(endpoint.toString(), {
          headers, signal: controller.signal
        }));
        if (response.status !== 101 || !response.webSocket) throw new Error("compute refused");
        const socket = response.webSocket;
        if (this.compute.get(meta.id) !== state || state.generation !== generation) {
          try { socket.close(1000, "stale compute handshake"); } catch { /* not accepted */ }
          return null;
        }
        socket.accept();
        state.socket = socket;
        state.failures = 0;
        state.nextAttempt = 0;
        socket.addEventListener("message", event => this.onComputeMessage(
          meta.id, state, generation, socket, event.data));
        socket.addEventListener("close", () => this.markComputeClosed(meta.id, socket));
        socket.addEventListener("error", () => this.markComputeClosed(meta.id, socket));
        socket.send(JSON.stringify({
          type: "start",
          stream_id: meta.id,
          source_lang: route.sourceLanguage,
          source_locale: route.sourceLocale,
          target_langs: route.targetLanguages,
          catalog_revision: CATALOG_REVISION,
          mt_revision: M2M_MODEL.revision,
        }));
        return socket;
      } catch {
        if (this.compute.get(meta.id) !== state || state.generation !== generation) return null;
        state.socket = null;
        state.failures += 1;
        state.nextAttempt = Date.now() + Math.min(
          COMPUTE_BACKOFF_MAX_MS,
          250 * 2 ** Math.min(state.failures, 5)
        );
        return null;
      } finally {
        if (state.generation === generation) {
          state.connecting = null;
          state.abort = null;
        }
      }
    })();
    return state.connecting;
  }

  private onComputeCaption(
    participantId: string, state: ComputeState, generation: number,
    socket: WebSocket, raw: string,
  ): void {
    if (this.compute.get(participantId) !== state || state.generation !== generation
        || state.socket !== socket) return;
    if (new TextEncoder().encode(raw).byteLength > MAX_COMPUTE_MESSAGE_BYTES) return;
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      data = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (data.type !== "caption" || typeof data.final !== "boolean"
        || !Number.isSafeInteger(data.seq) || (data.seq as number) < 0
        || typeof data.original !== "string"
        || (data.original as string).length > MAX_CAPTION_CHARS
        || !data.translations || typeof data.translations !== "object"
        || Array.isArray(data.translations)) return;
    const participant = this.participants().find(({ meta }) => meta.id === participantId);
    if (!participant) return;
    const translations: Record<string, string> = {};
    const permitted = new Set(this.computeRoute(participant.meta).targetLanguages);
    for (const lang of permitted) {
      const value = (data.translations as Record<string, unknown>)[lang];
      if (typeof value === "string" && value.length <= MAX_CAPTION_CHARS) {
        translations[lang] = value;
      }
    }
    const tMs = typeof data.t_ms === "number" && Number.isFinite(data.t_ms)
      ? Math.max(0, Math.round(data.t_ms)) : 0;
    this.broadcast({
      type: "caption",
      // The authenticated compute adapter still does not own room identity.
      // Attribution comes from the browser socket whose PCM opened this stream.
      speaker: participant.meta.id,
      speaker_lang: participant.meta.lang,
      seq: data.seq,
      final: data.final,
      original: data.original,
      translations,
      t_ms: tMs
    });
  }

  async fetch(request: Request): Promise<Response> {
    const expiresAt = Number(request.headers.get("X-Room-Expires"));
    if (!Number.isSafeInteger(expiresAt)
        || expiresAt <= Math.floor(Date.now() / 1000)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const storedExpiry = await this.ctx.storage.get<number>("expiresAt");
    if (storedExpiry !== undefined && storedExpiry <= Math.floor(Date.now() / 1000)) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return new Response("Unauthorized", { status: 401 });
    }
    if (storedExpiry !== undefined && storedExpiry !== expiresAt) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (storedExpiry === undefined) {
      await this.ctx.storage.put("expiresAt", expiresAt);
      await this.ctx.storage.setAlarm(expiresAt * 1000);
    } else if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(expiresAt * 1000);
    }

    const url = new URL(request.url);
    const closedAt = await this.ctx.storage.get<number>("closedAt");
    if (request.method === "GET" && url.pathname === "/host-status") {
      this.sweepExpiredSockets(Date.now());
      const participantCount = closedAt === undefined ? this.participants().length : 0;
      return Response.json({
        state: closedAt === undefined ? (participantCount ? "open" : "ready") : "closed",
        participant_count: participantCount,
        participant_limit: MAX_PARTICIPANTS
      });
    }
    if (request.method === "POST" && url.pathname === "/close") {
      if (closedAt === undefined) {
        await this.ctx.storage.put("closedAt", Date.now());
        this.closeRoom();
        await this.flushUsage();
      }
      return Response.json({
        state: "closed", participant_count: 0, participant_limit: MAX_PARTICIPANTS
      });
    }
    if (closedAt !== undefined) return new Response("Room expired or unavailable", { status: 410 });
    if (request.method === "GET" && url.pathname === "/status") {
      this.sweepExpiredSockets(Date.now());
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/owner") {
      const userId = request.headers.get("X-User-ID") || "";
      if (!USER_ID_PATTERN.test(userId)) return new Response("Invalid owner", { status: 400 });
      // Write-once. The account that created the room is the only account its
      // usage can ever be billed to, whatever arrives later.
      if (await this.ctx.storage.get<string>("owner") === undefined) {
        await this.ctx.storage.put("owner", userId);
      }
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/tts-quota") {
      const participantId = request.headers.get("X-Participant-ID") || "";
      const locale = request.headers.get("X-Target-Locale") || "";
      const voiceProfileId = request.headers.get("X-Voice-Profile") || "";
      const result = this.consumeTts(participantId, locale, voiceProfileId);
      if (result.allowed) {
        // consumeTts's allowed branch is the one place a translated-voice
        // phrase is authorized, so it is the one place the meter moves.
        await this.bumpUsage("tts", 1);
        return new Response(null, { status: 204 });
      }
      if (!result.retryAfter) return new Response("Forbidden", { status: 403 });
      return new Response("Rate limit reached", {
        status: 429, headers: { "Retry-After": String(result.retryAfter) }
      });
    }
    if (request.method === "POST" && url.pathname === "/report-quota") {
      const status = await this.reserveReport(request.headers.get("X-Participant-ID") || "");
      const headers = status === 429 ? {"Retry-After": "86400"} : undefined;
      return new Response(status === 204 ? null : status === 409 ? "Already reported"
        : status === 429 ? "Rate limit reached" : "Forbidden", {status, headers});
    }
    if (request.method === "POST" && url.pathname === "/report-rollback") {
      await this.rollbackReport(request.headers.get("X-Participant-ID") || "");
      return new Response(null, {status: 204});
    }
    if (request.method === "POST" && url.pathname === "/turn-quota") {
      const result = await this.consumeStoredQuota(
        "turnQuota", TURN_ROOM_LIMIT, TURN_ROOM_WINDOW_MS
      );
      if (result.allowed) return new Response(null, {status: 204});
      return new Response("Rate limit reached", {
        status: 429, headers: {"Retry-After": String(result.retryAfter)}
      });
    }
    if (request.method !== "GET"
        || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const now = Date.now();
    this.sweepExpiredSockets(now);
    if (this.leasedSocketCount(now) >= MAX_PENDING_SOCKETS) {
      return new Response("Room connection capacity reached", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const meta: ParticipantAttachment = {
      kind: "browser",
      id: base64url(crypto.getRandomValues(new Uint8Array(12))),
      joined: false,
      locale: "en-US",
      lang: "en",
      name: "Speaker",
      voiceProfileId: "en-us-af-heart",
      lastSeenAt: Date.now(),
      ttsWindowStart: 0,
      ttsCount: 0,
      reported: false
    };
    server.serializeAttachment(meta);
    this.ctx.acceptWebSocket(server, ["browser"]);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const meta = this.attachment(socket);
    if (!meta) return this.policyClose(socket, "missing participant state");

    if (typeof message !== "string") {
      if (!meta.joined) return this.policyClose(socket, "join required");
      if (message.byteLength > MAX_PCM_FRAME_BYTES) {
        socket.close(1009, "microphone frame too large");
        return;
      }
      if (!this.consumePcm(meta.id, message.byteLength)) {
        this.closeCompute(meta.id);
        this.policyClose(socket, "microphone rate exceeded");
        return;
      }
      const now = Date.now();
      if (!Number.isFinite(meta.lastSeenAt)
          || now - meta.lastSeenAt >= PRESENCE_HEARTBEAT_MS) {
        meta.lastSeenAt = now;
        socket.serializeAttachment(meta);
        this.sweepExpiredSockets(now);
      }
      const compute = await this.ensureCompute(meta);
      if (compute?.readyState === 1) compute.send(message);
      // Frames are deliberately not queued while Modal reconnects. This bounds
      // memory and latency; natural peer audio remains independent and live.
      return;
    }
    const messageBytes = new TextEncoder().encode(message).byteLength;
    if (messageBytes > SIGNAL_MESSAGE_BYTES) {
      socket.close(1009, "control message too large");
      return;
    }
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(message) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      data = parsed as Record<string, unknown>;
    } catch {
      return this.policyClose(socket, "invalid JSON control message");
    }
    if (messageBytes > CONTROL_MESSAGE_BYTES && data.type !== "signal") {
      socket.close(1009, "control message too large");
      return;
    }

    if (!meta.joined) {
      if (data.type !== "join") return this.policyClose(socket, "join required");
      this.sweepExpiredSockets(Date.now());
      const participants = this.participants();
      if (participants.length >= MAX_PARTICIPANTS) {
        this.send(socket, {
          type: "room_full",
          limit: MAX_PARTICIPANTS,
          participant_count: participants.length
        });
        socket.close(1013, "room full");
        return;
      }
      const selection = this.resolveLocaleVoice(data.locale, data.voice_profile);
      if ("reason" in selection) return this.policyClose(socket, selection.reason);
      const { locale, voice: selectedVoice } = selection;
      meta.joined = true;
      meta.locale = locale.id;
      meta.lang = locale.language;
      const requestedName = typeof data.name === "string" ? data.name.trim() : "";
      meta.name = requestedName.slice(0, 40) || "Speaker";
      meta.voiceProfileId = selectedVoice?.id || null;
      meta.lastSeenAt = Date.now();
      if (participants.length) {
        meta.ttsWindowStart = participants[0].meta.ttsWindowStart || 0;
        meta.ttsCount = participants[0].meta.ttsCount || 0;
      }
      socket.serializeAttachment(meta);
      // 0 -> 1 starts the call clock. Later joins ride the same segment: the
      // room is metered while it is occupied, not per participant.
      if (!participants.length) await this.ctx.storage.put("activeSince", Date.now());
      this.send(socket, {
        type: "welcome",
        id: meta.id,
        catalog_revision: CATALOG_REVISION,
        tts_provider: "kokoro",
        participant_count: participants.length + 1,
        participant_limit: MAX_PARTICIPANTS,
        heartbeat_interval_ms: PRESENCE_HEARTBEAT_MS,
        presence_lease_ms: PRESENCE_LEASE_MS,
        peers: participants.map(({ meta: peer }) => this.publicParticipant(peer))
      });
      this.broadcast({
        type: "peer_join",
        ...this.publicParticipant(meta),
        participant_count: participants.length + 1,
        participant_limit: MAX_PARTICIPANTS
      }, socket);
      this.refreshComputeRoutes();
      return;
    }

    meta.lastSeenAt = Date.now();
    socket.serializeAttachment(meta);
    this.sweepExpiredSockets(meta.lastSeenAt);

    if (data.type === "heartbeat") {
      this.send(socket, {
        type: "presence",
        participant_count: this.participants().length,
        participant_limit: MAX_PARTICIPANTS
      });
      return;
    }

    if (data.type === "leave") {
      this.removeParticipant(socket, meta, "left room", true);
      return;
    }

    if (data.type === "set_locale") {
      const selection = this.resolveLocaleVoice(data.locale, data.voice_profile);
      if ("reason" in selection) return this.policyClose(socket, selection.reason);
      const { locale, voice: selectedVoice } = selection;
      meta.locale = locale.id;
      meta.lang = locale.language;
      meta.voiceProfileId = selectedVoice?.id || null;
      socket.serializeAttachment(meta);
      this.refreshComputeRoutes();
      this.broadcast({ type: "peer_update", ...this.publicParticipant(meta) });
      return;
    }
    if (data.type === "set_voice_profile") {
      const selection = this.resolveLocaleVoice(meta.locale, data.voice_profile);
      if ("reason" in selection) return this.policyClose(socket, selection.reason);
      const selectedVoice = selection.voice;
      meta.voiceProfileId = selectedVoice?.id || null;
      socket.serializeAttachment(meta);
      this.broadcast({ type: "peer_update", ...this.publicParticipant(meta) });
      return;
    }
    if (data.type === "speech_end") {
      const compute = await this.ensureCompute(meta);
      if (compute?.readyState === 1) compute.send(JSON.stringify({ type: "speech_end" }));
      return;
    }
    if (data.type === "signal") {
      if (typeof data.to !== "string" || !data.data || typeof data.data !== "object"
          || Array.isArray(data.data)) return this.policyClose(socket, "invalid signal");
      const target = this.participants().find(({ meta: peer }) => peer.id === data.to);
      if (target) this.send(target.socket, {
        type: "signal", from: meta.id, data: data.data
      });
      return;
    }
    if (data.type === "chat") {
      await this.relayChat(socket, meta, data);
      return;
    }
    // Captions are server-authored Modal output. Closing a browser that tries
    // to author one makes the privilege boundary explicit and fail-closed.
    this.policyClose(socket, "unsupported control message");
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    const meta = this.attachment(socket);
    if (meta?.joined) this.removeParticipant(socket, meta, reason || "socket closed", false);
    try {
      socket.close(code || 1000, reason.slice(0, 120));
    } catch {
      // The peer may already have completed the close handshake.
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const meta = this.attachment(socket);
    if (meta?.joined) this.removeParticipant(socket, meta, "socket error", false);
    try { socket.close(1011, "socket error"); } catch { /* already closed */ }
  }

  async alarm(): Promise<void> {
    for (const socket of this.ctx.getWebSockets("browser")) {
      const meta = this.attachment(socket);
      if (meta) {
        // Mark first: the expired room is empty for metering purposes before
        // the meter is read, so the final call segment banks exactly once.
        meta.joined = false;
        socket.serializeAttachment(meta);
        this.closeCompute(meta.id);
      }
      try { socket.close(1008, "room expired"); } catch { /* already closed */ }
    }
    this.pcmBudgets.clear();
    // Expiry is the last chance to bank a room that nobody closed by hand.
    await this.flushUsage();
    await this.ctx.storage.deleteAll();
  }
}

export class AbuseGate extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method Not Allowed", {status: 405});
    const limit = Number(request.headers.get("X-Quota-Limit"));
    const windowMs = Number(request.headers.get("X-Quota-Window-Ms"));
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000
        || !Number.isSafeInteger(windowMs) || windowMs < 1000
        || windowMs > 24 * 60 * 60 * 1000) {
      return new Response("Invalid quota", {status: 400});
    }
    const now = Date.now();
    const state = await this.ctx.storage.get<{windowStart: number; count: number}>("quota");
    const current = !state || now - state.windowStart >= windowMs
      ? {windowStart: now, count: 0} : state;
    if (current.count >= limit) {
      return new Response("Rate limit reached", {
        status: 429,
        headers: {"Retry-After": String(Math.max(
          1, Math.ceil((current.windowStart + windowMs - now) / 1000)
        ))}
      });
    }
    current.count += 1;
    await this.ctx.storage.put("quota", current);
    await this.ctx.storage.setAlarm(current.windowStart + windowMs);
    return new Response(null, {status: 204});
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

type StoredReport = {
  id: string;
  created_at: string;
  category: string;
  platform: string;
  room_ref: string;
  room_id: string;
  room_expires: number;
};

export class ReportInbox extends DurableObject<Env> {
  private async retained(): Promise<Map<string, StoredReport>> {
    const rows = await this.ctx.storage.list<StoredReport>({prefix: "report:"});
    const cutoff = Date.now() - REPORT_RETENTION_MS;
    const expired = [...rows].filter(([, value]) => Date.parse(value.created_at) < cutoff);
    if (expired.length) await this.ctx.storage.delete(expired.map(([key]) => key));
    for (const [key] of expired) rows.delete(key);
    if (rows.size > REPORT_MAX_RECORDS) {
      const oldest = [...rows.entries()].sort((left, right) =>
        left[1].created_at.localeCompare(right[1].created_at)
      ).slice(0, rows.size - REPORT_MAX_RECORDS).map(([key]) => key);
      await this.ctx.storage.delete(oldest);
      for (const key of oldest) rows.delete(key);
    }
    if (rows.size) {
      const earliestExpiry = Math.min(...[...rows.values()].map(
        report => Date.parse(report.created_at) + REPORT_RETENTION_MS
      ));
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, earliestExpiry));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    return rows;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const resolveMatch = url.pathname.match(/^\/resolve\/([A-Za-z0-9_-]{22})$/);
    if (request.method === "GET" && resolveMatch) {
      const report = await this.ctx.storage.get<StoredReport>(`report:${resolveMatch[1]}`);
      if (!report) return new Response("Not found", {status: 404});
      return Response.json({room_id: report.room_id, room_expires: report.room_expires});
    }
    if (request.method === "GET") {
      const rows = await this.retained();
      return Response.json({reports: [...rows.values()].sort(
        (left, right) => right.created_at.localeCompare(left.created_at)
      ).map(({id, created_at, category, platform, room_ref}) => ({
        id, created_at, category, platform, room_ref
      }))}, {headers: {"Cache-Control": "no-store"}});
    }
    if (request.method !== "POST") return new Response("Method Not Allowed", {status: 405});
    let data: Partial<StoredReport> & {submission_id?: unknown};
    try { data = await request.json<Partial<StoredReport> & {submission_id?: unknown}>(); }
    catch { return new Response("Invalid report", {status: 400}); }
    if (!data.category || !REPORT_CATEGORIES.has(data.category)
        || !data.platform || !REPORT_PLATFORMS.has(data.platform)
        || !data.room_ref || !/^[A-Za-z0-9_-]{16}$/.test(data.room_ref)
        || typeof data.submission_id !== "string"
        || !/^[A-Za-z0-9_-]{22}$/.test(data.submission_id)
        || !data.room_id || !/^[A-Za-z0-9_-]{24}$/.test(data.room_id)
        || !Number.isSafeInteger(data.room_expires)) {
      return new Response("Invalid report", {status: 400});
    }
    const key = `report:${data.submission_id}`;
    if (await this.ctx.storage.get<StoredReport>(key)) {
      await this.retained();
      return Response.json({status: "stored"}, {status: 200});
    }
    const now = new Date();
    const id = data.submission_id;
    const report: StoredReport = {
      id, created_at: now.toISOString(), category: data.category,
      platform: data.platform, room_ref: data.room_ref,
      room_id: data.room_id, room_expires: data.room_expires!
    };
    await this.ctx.storage.put(key, report);
    await this.retained();
    return Response.json({status: "stored"}, {status: 201});
  }

  async alarm(): Promise<void> {
    await this.retained();
  }
}

type UserProfile = {
  user_id: string; provider: string; name: string; email: string; created_at: string;
};
type UserTotals = { call_minutes: number; chat_messages: number; tts_phrases: number };
type UsageRecord = { at: string; kind: string; units: number; room_ref: string };

const EMPTY_TOTALS: UserTotals = { call_minutes: 0, chat_messages: 0, tts_phrases: 0 };

// One object per account: profile, credit balance, lifetime totals, and a
// capped window of usage rows. Nothing here identifies a room or a peer.
export class UserDirectory extends DurableObject<Env> {
  private async retained(): Promise<Map<string, UsageRecord>> {
    const rows = await this.ctx.storage.list<UsageRecord>({ prefix: "usage:" });
    const cutoff = Date.now() - USAGE_RETENTION_MS;
    const expired = [...rows].filter(([, value]) => Date.parse(value.at) < cutoff);
    if (expired.length) await this.ctx.storage.delete(expired.map(([key]) => key));
    for (const [key] of expired) rows.delete(key);
    if (rows.size > USAGE_MAX_RECORDS) {
      const oldest = [...rows.keys()].sort().slice(0, rows.size - USAGE_MAX_RECORDS);
      await this.ctx.storage.delete(oldest);
      for (const key of oldest) rows.delete(key);
    }
    if (rows.size) {
      const earliestExpiry = Math.min(...[...rows.values()].map(
        row => Date.parse(row.at) + USAGE_RETENTION_MS
      ));
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, earliestExpiry));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    return rows;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      const profile = await this.ctx.storage.get<UserProfile>("profile");
      if (!profile) return new Response("Not found", { status: 404 });
      const rows = await this.retained();
      return Response.json({
        user: { name: profile.name, email: profile.email, provider: profile.provider },
        credits: await this.ctx.storage.get<{ balance: number }>("credits") || { balance: 0 },
        totals: await this.ctx.storage.get<UserTotals>("totals") || { ...EMPTY_TOTALS },
        recent: [...rows.entries()].sort((left, right) => right[0].localeCompare(left[0]))
          .slice(0, 20).map(([, row]) => row),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "DELETE" && url.pathname === "/") {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    let data: Record<string, unknown>;
    try {
      const parsed = await request.json<unknown>();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      data = parsed as Record<string, unknown>;
    } catch {
      return new Response("Invalid request", { status: 400 });
    }
    if (url.pathname === "/") {
      if (typeof data.user_id !== "string" || !USER_ID_PATTERN.test(data.user_id)
          || typeof data.provider !== "string" || !/^[a-z]{1,20}$/.test(data.provider)
          || typeof data.name !== "string" || typeof data.email !== "string") {
        return new Response("Invalid profile", { status: 400 });
      }
      const existing = await this.ctx.storage.get<UserProfile>("profile");
      await this.ctx.storage.put("profile", {
        user_id: data.user_id, provider: data.provider,
        name: data.name.slice(0, 80), email: data.email.slice(0, 160),
        created_at: existing?.created_at || new Date().toISOString(),
      });
      if (!existing) {
        // Purchase is stubbed, so a new account starts at zero and stays there
        // until a real purchase path exists. Metering is real regardless.
        await this.ctx.storage.put("credits", { balance: 0 });
        await this.ctx.storage.put("totals", { ...EMPTY_TOTALS });
      }
      return Response.json({ status: "stored" }, { status: existing ? 200 : 201 });
    }
    if (url.pathname !== "/usage") return new Response("Not found", { status: 404 });
    const total = typeof data.kind === "string" ? USAGE_TOTALS.get(data.kind) : undefined;
    if (!total || typeof data.units !== "number" || !Number.isSafeInteger(data.units)
        || data.units < 1 || data.units > 100_000
        || typeof data.room_ref !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(data.room_ref)) {
      return new Response("Invalid usage", { status: 400 });
    }
    // No profile means the account was deleted while a room was still open.
    // The caller drops the write on this 404: deletion must not resurrect.
    if (!await this.ctx.storage.get<UserProfile>("profile")) {
      return new Response("Not found", { status: 404 });
    }
    const totals = await this.ctx.storage.get<UserTotals>("totals") || { ...EMPTY_TOTALS };
    totals[total as keyof UserTotals] += data.units;
    const suffix = base64url(crypto.getRandomValues(new Uint8Array(3)));
    await this.ctx.storage.put(`usage:${Date.now()}-${suffix}`, {
      at: new Date().toISOString(), kind: data.kind as string,
      units: data.units, room_ref: data.room_ref,
    });
    await this.ctx.storage.put("totals", totals);
    await this.retained();
    return new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    await this.retained();
  }
}

async function routeRequest(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" }, {
        headers: { "Cache-Control": "no-store" }
      });
    }
    if (request.method === "GET" && url.pathname === "/api/capabilities") {
      return Response.json(publicCatalog(), { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/assetlinks.json") {
      return androidAssociation(env);
    }
    if (request.method === "GET"
        && url.pathname === "/.well-known/apple-app-site-association") {
      return appleAssociation(env);
    }
    if (url.pathname === "/api/room") return roomPreflight(request, env);
    if (url.pathname === "/api/turn") return turnCredentials(request, env);
    if (url.pathname === "/api/reports") return abuseReport(request, env);
    if (url.pathname === "/api/internal/reports"
        || /^\/api\/internal\/reports\/[A-Za-z0-9_-]{22}\/close$/.test(url.pathname)) {
      return reportInbox(request, env);
    }
    if (url.pathname === "/tts") return translatedVoice(request, env);
    if (url.pathname === "/api/room-control") return hostRoomStatus(request, env);
    if (url.pathname === "/api/room-control/close") return closeHostRoom(request, env);
    if (url.pathname === "/api/me") return accountSnapshot(request, env);
    if (url.pathname === "/api/account/delete") return accountDelete(request, env);
    if (url.pathname === "/auth/logout") return authLogout(request, env);
    const authMatch = url.pathname.match(/^\/auth\/([a-z]{1,20})\/(start|callback)$/);
    if (authMatch) {
      return authMatch[2] === "start"
        ? authStart(request, env, authMatch[1])
        : authCallback(request, env, authMatch[1]);
    }
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      return createRoomResponse(request, env, ctx);
    }
    if (request.method === "POST" && url.pathname === "/rooms") {
      return createRoomRedirect(request, env, ctx);
    }
    const roomMatch = url.pathname.match(/^\/room\/([^/]+)$/);
    if (request.method === "GET" && roomMatch) {
      return roomPage(request, env, roomMatch[1], ctx);
    }
    const socketMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (socketMatch) {
      if (request.method !== "GET"
          || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      if (!sameOrigin(request, env)) return new Response("Forbidden", { status: 403 });
      const room = await verifyRoom(socketMatch[1], env.ROOM_SIGNING_KEY);
      if (!room) return new Response("Unauthorized", { status: 401 });
      // Token verification precedes both idFromName() and get(): forged or
      // expired links never select, construct, or wake a Durable Object.
      const id = env.ROOMS.idFromName(room.id);
      const stub = env.ROOMS.get(id);
      const headers = new Headers(request.headers);
      headers.set("X-Room-Expires", String(room.expiresAt));
      return stub.fetch(new Request("https://room.internal/socket", { headers }));
    }
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    const publicPage = PUBLIC_PAGES.get(url.pathname);
    if (publicPage) {
      const headers = privateHeaders();
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      return new Response(publicPage, { headers });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const asset = await env.ASSETS.fetch(request);
      return new Response(asset.body, { status: asset.status, headers: privateHeaders(asset.headers) });
    }
    // FastAPI mounts the shared files at /static; Workers assets expose the
    // contents of that directory at /. Rewrite only that compatibility prefix.
    if (url.pathname.startsWith("/static/")) {
      url.pathname = url.pathname.slice("/static".length);
      return env.ASSETS.fetch(new Request(url, request));
    }
    const asset = await env.ASSETS.fetch(request);
    if (url.pathname !== "/sw.js" || !asset.ok) return asset;
    const headers = new Headers(asset.headers);
    headers.set("Service-Worker-Allowed", "/");
    headers.set("Cache-Control", "no-store");
    return new Response(asset.body, { status: asset.status, headers });
}

async function consumeIpQuota(
  request: Request, env: Env, action: string, limit: number, windowMs: number,
): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP");
  // Cloudflare supplies this header in production. Local development and unit
  // tests without an edge identity stay usable; callers testing the quota send
  // the same edge-owned header explicitly.
  if (!ip) return null;
  const digest = base64url(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(ip)
  ));
  const response = await env.ABUSE.get(env.ABUSE.idFromName(`${action}:${digest}`)).fetch(
    new Request("https://abuse.internal/consume", {
      method: "POST",
      headers: {"X-Quota-Limit": String(limit), "X-Quota-Window-Ms": String(windowMs)}
    })
  );
  if (response.status === 204) return null;
  if (response.status !== 429) {
    return new Response("Abuse controls unavailable", {
      status: 503, headers: {"Cache-Control": "no-store"}
    });
  }
  return new Response("Rate limit reached", {
    status: 429,
    headers: {"Retry-After": response.headers.get("Retry-After") || "60", "Cache-Control": "no-store"}
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // An unhandled throw here is served as the runtime's own error page, which
    // is neither no-store nor ours. One boundary at the entry point keeps every
    // unexpected failure a plain 500 that no cache will keep.
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS" && url.pathname.startsWith("/api/v1/")) {
        return mobilePreflight(request);
      }
      if (url.pathname === "/api/v1/mobile/bootstrap") {
        if (request.method !== "GET") return mobileCors(
          request, new Response("Method Not Allowed", { status: 405 })
        );
        return mobileCors(request, mobileBootstrap(request, env));
      }
      const alias = MOBILE_API_ALIASES.get(url.pathname);
      if (url.pathname.startsWith("/api/v1/")) {
        if (!alias) return mobileCors(request, new Response("Not Found", { status: 404 }));
        url.pathname = alias;
        return mobileCors(request, await routeRequest(new Request(url, request), env, ctx));
      }
      const socket = url.pathname.match(/^\/ws\/v1\/(.+)$/);
      if (socket) {
        url.pathname = `/ws/${socket[1]}`;
        return await routeRequest(new Request(url, request), env, ctx);
      }
      return await routeRequest(request, env, ctx);
    } catch {
      return new Response("Service unavailable", {
        status: 500, headers: {"Cache-Control": "no-store"}
      });
    }
  }
} satisfies ExportedHandler<Env>;

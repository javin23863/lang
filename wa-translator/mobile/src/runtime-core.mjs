export const PUBLIC_ORIGIN =
  "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev";
export const STAGING_PUBLIC_ORIGIN =
  "https://spoken-translation-room-staging.spoken-translation-cloudflare.workers.dev";

const ALLOWED_PUBLIC_ORIGINS = new Set([PUBLIC_ORIGIN, STAGING_PUBLIC_ORIGIN]);

/** @param {unknown} value */
export function resolvePublicOrigin(value = "") {
  const origin = String(value || PUBLIC_ORIGIN).trim();
  if (!ALLOWED_PUBLIC_ORIGINS.has(origin)) {
    throw new Error(`Unsupported Lingua Relay public origin: ${origin}`);
  }
  return origin;
}

const INJECTED_PUBLIC_ORIGIN = Reflect.get(globalThis, "__LINGUA_PUBLIC_ORIGIN__");
export const ACTIVE_PUBLIC_ORIGIN = resolvePublicOrigin(INJECTED_PUBLIC_ORIGIN);
export const MOBILE_PROTOCOL = 2;
export const MOBILE_BUILD = 1;
export const PARTICIPANT_LIMIT = 2;
export const MOBILE_AUTH_SCHEME = "com.javin23863.linguarelay";

const ROOM_TOKEN_PATTERN =
  /^[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}$/;
const SESSION_V1_PATTERN =
  /^s1\.[A-Za-z0-9_-]{22}\.\d{10}\.[A-Za-z0-9_-]{43}$/;
const SESSION_V2_PATTERN =
  /^s2\.[A-Za-z0-9_-]{22}\.\d{10}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
const NATIVE_HANDOFF_PATTERN =
  /^nh2\.(google|apple|facebook)\.[A-Za-z0-9_-]{22}\.\d{10}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
const MAX_DEEP_LINK_CHARS = 1024;

const VERSIONED_PATHS = new Map([
  ["/api/capabilities", "/api/v1/capabilities"],
  ["/api/rooms", "/api/v1/rooms"],
  ["/api/room", "/api/v1/room"],
  ["/api/room-control", "/api/v1/room-control"],
  ["/api/room-control/close", "/api/v1/room-control/close"],
  ["/api/turn", "/api/v1/turn"],
  ["/api/reports", "/api/v1/reports"],
  ["/api/me", "/api/v1/me"],
  ["/api/account/delete", "/api/v1/account/delete"],
  ["/auth/logout", "/api/v1/auth/logout"],
  ["/tts", "/api/v1/tts"]
]);

const ROOM_MODES = ["voice", "chat", "video"];
const NATIVE_AUTH_PROVIDERS = new Set(["google", "apple", "facebook"]);

/** @param {unknown} value */
function boundedLink(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_DEEP_LINK_CHARS;
}

/** @param {string | null | undefined} value */
function roomMode(value) {
  return value && ROOM_MODES.includes(value) ? value : "video";
}

/** @param {string | null | undefined} value */
function roomName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return "";
  return name;
}

/** @param {string} value */
export function parseRoomLink(value) {
  if (!boundedLink(value)) return null;
  try {
    const url = new URL(value);
    if (url.origin !== ACTIVE_PUBLIC_ORIGIN || url.hash) return null;
    const match = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!match || !ROOM_TOKEN_PATTERN.test(match[1])) return null;
    const entries = [...url.searchParams.entries()];
    if (entries.some(([key]) => key !== "m" && key !== "n")
        || entries.filter(([key]) => key === "m").length > 1
        || entries.filter(([key]) => key === "n").length > 1) return null;
    const mode = roomMode(url.searchParams.get("m"));
    const rawName = url.searchParams.get("n");
    const name = rawName === null ? "" : roomName(rawName);
    if (rawName !== null && (!name || mode !== "voice")) return null;
    return name ? {token: match[1], mode, name} : {token: match[1], mode};
  } catch {
    return null;
  }
}

/** @param {string} value */
export function parseNativeAuthLink(value) {
  if (!boundedLink(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== `${MOBILE_AUTH_SCHEME}:` || url.hostname !== "auth" || url.search) return null;
    const provider = url.pathname.match(/^\/(google|apple|facebook)$/)?.[1];
    if (!provider || !NATIVE_AUTH_PROVIDERS.has(provider)) return null;
    const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const entries = [...params.entries()];
    if (entries.length !== 1) return null;
    if (entries[0][0] === "auth" && entries[0][1] === "failed") return {error: "failed", provider};
    if (entries[0][0] !== "handoff" || !NATIVE_HANDOFF_PATTERN.test(entries[0][1])) return null;
    const parts = entries[0][1].split(".");
    if (parts[1] !== provider) return null;
    const expiresAt = Number(parts[3]);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return {handoff: entries[0][1], provider};
  } catch {
    return null;
  }
}

/** @param {unknown} value */
export function isRoomToken(value) {
  return ROOM_TOKEN_PATTERN.test(String(value || ""));
}

/** @param {unknown} value */
export function isSessionToken(value) {
  const token = String(value || "");
  if (!SESSION_V1_PATTERN.test(token) && !SESSION_V2_PATTERN.test(token)) return false;
  const expiresAt = Number(token.split(".")[2]);
  return Number.isSafeInteger(expiresAt) && expiresAt > Math.floor(Date.now() / 1000);
}

/** @param {string} path @param {boolean} native */
export function apiPath(path, native) {
  if (!native) return path;
  const auth = path.match(/^\/auth\/([a-z]{1,20})\/start$/);
  if (auth && NATIVE_AUTH_PROVIDERS.has(auth[1])) return `/auth/native/${auth[1]}/start`;
  const versioned = VERSIONED_PATHS.get(path);
  if (!versioned) throw new Error(`Unsupported native API path: ${path}`);
  return versioned;
}

/** @param {string} token @param {boolean} native */
export function websocketPath(token, native) {
  if (!isRoomToken(token)) throw new Error("Invalid room token");
  return `${native ? "/ws/v1/" : "/ws/"}${token}`;
}

/** @param {string} token @param {string} [mode] */
export function roomPageUrl(token, mode) {
  if (!isRoomToken(token)) throw new Error("Invalid room token");
  const params = new URLSearchParams({room: token});
  const resolved = roomMode(mode);
  if (resolved !== "video") params.set("m", resolved);
  return `room.html?${params.toString()}`;
}

export function createSecureHostStorage(adapter) {
  return {
    async getItem(key) {
      const value = await adapter.get(key);
      return typeof value === "string" ? value : null;
    },
    async setItem(key, value) { await adapter.set(key, value); },
    async removeItem(key) { await adapter.remove(key); },
  };
}

export function validateBootstrap(value, build) {
  if (!value || typeof value !== "object") return false;
  const bootstrap = value;
  return bootstrap.protocol === MOBILE_PROTOCOL
    && Number.isSafeInteger(bootstrap.minimum_client_build)
    && Number(bootstrap.minimum_client_build) <= build
    && bootstrap.public_origin === ACTIVE_PUBLIC_ORIGIN
    && bootstrap.account_mode === "session"
    && bootstrap.call_lifecycle === "foreground"
    && bootstrap.max_room_participants === PARTICIPANT_LIMIT;
}

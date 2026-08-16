export const PUBLIC_ORIGIN =
  "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev";
export const MOBILE_PROTOCOL = 1;
export const MOBILE_BUILD = 1;

const ROOM_TOKEN_PATTERN =
  /^[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}$/;

const VERSIONED_PATHS = new Map([
  ["/api/capabilities", "/api/v1/capabilities"],
  ["/api/rooms", "/api/v1/rooms"],
  ["/api/room", "/api/v1/room"],
  ["/api/room-control", "/api/v1/room-control"],
  ["/api/room-control/close", "/api/v1/room-control/close"],
  ["/api/turn", "/api/v1/turn"],
  ["/api/reports", "/api/v1/reports"],
  ["/tts", "/api/v1/tts"]
]);

/** @param {string} value */
export function parseRoomLink(value) {
  try {
    const url = new URL(value);
    if (url.origin !== PUBLIC_ORIGIN || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/room\/([^/]+)$/);
    return match && ROOM_TOKEN_PATTERN.test(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
export function isRoomToken(value) {
  return ROOM_TOKEN_PATTERN.test(String(value || ""));
}

/** @param {string} path @param {boolean} native */
export function apiPath(path, native) {
  if (!native) return path;
  const versioned = VERSIONED_PATHS.get(path);
  if (!versioned) throw new Error(`Unsupported native API path: ${path}`);
  return versioned;
}

/** @param {string} token @param {boolean} native */
export function websocketPath(token, native) {
  if (!isRoomToken(token)) throw new Error("Invalid room token");
  return `${native ? "/ws/v1/" : "/ws/"}${token}`;
}

/** @param {string} token */
export function roomPageUrl(token) {
  if (!isRoomToken(token)) throw new Error("Invalid room token");
  return `room.html?room=${encodeURIComponent(token)}`;
}

/**
 * Keep the host-control bearer behind the native secure-storage plug-in while
 * leaving the bridge small enough to test without a device runtime.
 * @param {{get(key: string): Promise<unknown>, set(key: string, value: string): Promise<unknown>, remove(key: string): Promise<unknown>}} adapter
 */
export function createSecureHostStorage(adapter) {
  return {
    /** @param {string} key */
    async getItem(key) {
      const value = await adapter.get(key);
      return typeof value === "string" ? value : null;
    },
    /** @param {string} key @param {string} value */
    async setItem(key, value) { await adapter.set(key, value); },
    /** @param {string} key */
    async removeItem(key) { await adapter.remove(key); },
  };
}

/** @param {unknown} value @param {number} build */
export function validateBootstrap(value, build) {
  if (!value || typeof value !== "object") return false;
  const bootstrap = /** @type {Record<string, unknown>} */ (value);
  return bootstrap.protocol === MOBILE_PROTOCOL
    && Number.isSafeInteger(bootstrap.minimum_client_build)
    && Number(bootstrap.minimum_client_build) <= build
    && bootstrap.public_origin === PUBLIC_ORIGIN
    && bootstrap.account_mode === "session"
    && bootstrap.call_lifecycle === "foreground";
}

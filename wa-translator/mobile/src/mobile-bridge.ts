import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

import {
  MOBILE_BUILD, PUBLIC_ORIGIN, apiPath, createSecureHostStorage, isRoomToken,
  isSessionToken, parseNativeAuthLink, parseRoomLink, roomPageUrl,
  validateBootstrap, websocketPath,
} from "./runtime-core.mjs";

declare global {
  interface Window {
    LinguaNative?: {
      isNative: boolean;
      publicOrigin: string;
      apiPath(path: string): string;
      websocketPath(token: string): string;
      isRoomToken(token: string): boolean;
      ready(): Promise<boolean>;
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
      share(value: {title: string; text: string; url: string}): Promise<boolean>;
      openRoom(token: string, mode?: string): boolean;
    };
  }
}

const isNative = Capacitor.isNativePlatform();
const hostStorage = createSecureHostStorage(SecureStorage);
const nativeFetch = window.fetch.bind(window);
const NATIVE_SESSION_KEY = "lingua-relay.native-session.v1";
const NATIVE_AUTH_BINDING_PREFIX = "lingua-relay.native-auth-binding.v3.";
const LEGACY_AUTH_BINDING_PREFIX = "lingua-relay.native-auth-binding.v2.";
const NATIVE_AUTH_START = /^\/auth\/(google|apple|facebook)\/start$/;
const NATIVE_AUTH_PROVIDERS = ["google", "apple", "facebook"] as const;
const MAX_HANDLED_AUTH_HANDOFFS = 16;
const NATIVE_REQUEST_TIMEOUT_MS = 15_000;
const SESSION_API_PATHS = new Set([
  "/api/v1/me", "/api/v1/rooms", "/api/v1/account/delete", "/api/v1/auth/logout"
]);
const LOCAL_DARK_CONTENT = new Set([
  "privacy.html", "terms.html", "support.html", "delete-account.html"
]);
let nativeSession: string | null = null;
const memoryAuthBindings = new Map<string, string>();
const authChallenges = new Map<string, string>();
const handledAuthHandoffs = new Set<string>();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function canonicalBinding(value: unknown): string | null {
  const input = typeof value === "string" ? value : "";
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/")
      + "=".repeat((4 - input.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return bytes.byteLength === 32 && base64url(bytes) === input ? input : null;
  } catch {
    return null;
  }
}

function authBindingKey(provider: string): string {
  return `${NATIVE_AUTH_BINDING_PREFIX}${provider}`;
}

function legacyAuthBindingKey(provider: string): string {
  return `${LEGACY_AUTH_BINDING_PREFIX}${provider}`;
}

async function bindingChallenge(binding: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(binding));
  return base64url(new Uint8Array(digest));
}

async function prepareAuthBinding(provider: string): Promise<void> {
  let binding: string | null = null;
  let migratedLegacy = false;
  try { binding = canonicalBinding(await hostStorage.getItem(authBindingKey(provider))); }
  catch { /* memory fallback below */ }

  // Preserve an in-flight OAuth attempt started by the previous build. Its raw
  // localStorage copy is removed only after the secure-storage migration has
  // actually succeeded; otherwise a process death could strand the callback.
  if (!binding) {
    try {
      const legacy = canonicalBinding(localStorage.getItem(legacyAuthBindingKey(provider)));
      if (legacy) {
        binding = legacy;
        migratedLegacy = true;
      }
    } catch { /* no legacy WebView storage */ }
  }
  if (!binding) binding = base64url(crypto.getRandomValues(new Uint8Array(32)));

  memoryAuthBindings.set(provider, binding);
  authChallenges.set(provider, await bindingChallenge(binding));
  let persisted = false;
  try {
    await hostStorage.setItem(authBindingKey(provider), binding);
    persisted = true;
  } catch { /* same-process auth still retains the binding in memory */ }
  if (!migratedLegacy || persisted) {
    try { localStorage.removeItem(legacyAuthBindingKey(provider)); }
    catch { /* legacy storage may be unavailable */ }
  }
}

const authBindingsReady: Promise<void> = isNative
  ? Promise.all(NATIVE_AUTH_PROVIDERS.map(provider => prepareAuthBinding(provider))).then(() => {})
  : Promise.resolve();

async function readAuthBinding(provider: string): Promise<string | null> {
  await authBindingsReady;
  const memory = canonicalBinding(memoryAuthBindings.get(provider));
  if (memory) return memory;
  try {
    const stored = canonicalBinding(await hostStorage.getItem(authBindingKey(provider)));
    if (stored) memoryAuthBindings.set(provider, stored);
    return stored;
  } catch {
    return null;
  }
}

async function retireAuthBinding(provider: string): Promise<void> {
  memoryAuthBindings.delete(provider);
  authChallenges.delete(provider);
  await hostStorage.removeItem(authBindingKey(provider)).catch(() => {});
  try { localStorage.removeItem(legacyAuthBindingKey(provider)); }
  catch { /* legacy storage may be unavailable */ }
}

function rememberAuthHandoff(handoff: string): boolean {
  if (handledAuthHandoffs.has(handoff)) return false;
  while (handledAuthHandoffs.size >= MAX_HANDLED_AUTH_HANDOFFS) {
    const oldest = handledAuthHandoffs.values().next().value;
    if (typeof oldest !== "string") break;
    handledAuthHandoffs.delete(oldest);
  }
  handledAuthHandoffs.add(handoff);
  return true;
}

async function nativeFetchWithTimeout(
  input: RequestInfo | URL, init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NATIVE_REQUEST_TIMEOUT_MS);
  try {
    return await nativeFetch(input, {...init, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

function nativeApiPath(path: string): string {
  const resolved = apiPath(path, true);
  const provider = path.match(NATIVE_AUTH_START)?.[1];
  if (!provider) return resolved;
  const challenge = authChallenges.get(provider);
  if (!challenge) throw new Error("Native authentication is unavailable");
  // Only the SHA-256 challenge enters browser history or edge logs. The 256-bit
  // binding that proves possession on handoff exchange stays in app storage.
  return `${resolved}?challenge=${encodeURIComponent(challenge)}`;
}

async function clearNativeSession(): Promise<void> {
  nativeSession = null;
  await hostStorage.removeItem(NATIVE_SESSION_KEY).catch(() => {});
}

const sessionReady: Promise<void> = isNative ? hostStorage.getItem(NATIVE_SESSION_KEY)
  .then(async value => {
    if (isSessionToken(value)) {
      nativeSession = value;
      return;
    }
    if (value) await hostStorage.removeItem(NATIVE_SESSION_KEY);
  })
  .catch(() => {}) : Promise.resolve();

if (isNative) {
  // The bundled WebView is intentionally cookie-independent. Only account and
  // room-creation calls receive the native session bearer; room/TURN/TTS calls
  // already carry their own room-scoped Authorization credentials. Waiting for
  // authBindingsReady also means provider links can remain synchronous after
  // /api/me renders them: their browser-safe challenges are already prepared.
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await Promise.all([sessionReady, authBindingsReady]);
    const resolved = typeof input === "string" ? new URL(input, location.href).toString() : input;
    let request = new Request(resolved, init);
    const url = new URL(request.url);
    let attachedNativeSession = false;
    if (url.origin === PUBLIC_ORIGIN && SESSION_API_PATHS.has(url.pathname)
        && nativeSession && !request.headers.has("Authorization")) {
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${nativeSession}`);
      request = new Request(request, {headers});
      attachedNativeSession = true;
    }
    const response = await nativeFetch(request);
    let clearSession = response.ok && request.method === "POST"
      && (url.pathname === "/api/v1/auth/logout"
        || url.pathname === "/api/v1/account/delete");

    // A stale native bearer must repair itself. Room creation returns 401 for an
    // invalid/expired session; /api/v1/me deliberately returns a signed-out 200
    // so browser callers can render providers without treating it as an error.
    if (!clearSession && attachedNativeSession && response.status === 401) {
      clearSession = true;
    }
    if (!clearSession && attachedNativeSession && response.ok
        && request.method === "GET" && url.pathname === "/api/v1/me") {
      try {
        const account = await response.clone().json() as {signed_in?: unknown};
        if (account.signed_in === false) clearSession = true;
      } catch { /* malformed account JSON is handled by the dashboard */ }
    }
    if (clearSession) await clearNativeSession();
    return response;
  };
}

const compatibilityReady = isNative ? (async () => {
  const info = await App.getInfo();
  const build = Number.parseInt(info.build, 10);
  const response = await nativeFetchWithTimeout(`${PUBLIC_ORIGIN}/api/v1/mobile/bootstrap`, {
    cache: "no-store", headers: {Accept: "application/json"},
  });
  if (!response.ok || !Number.isSafeInteger(build) || build < MOBILE_BUILD) {
    throw new Error("Mobile compatibility unavailable");
  }
  if (!validateBootstrap(await response.json(), build)) {
    throw new Error("This app version is no longer supported");
  }
  return true;
})() : Promise.resolve(true);

function openRoom(token: string, mode?: string): boolean {
  if (!isRoomToken(token)) return false;
  window.location.replace(roomPageUrl(token, mode));
  return true;
}

async function acceptNativeHandoff(provider: string, handoff: string): Promise<void> {
  const binding = await readAuthBinding(provider);
  if (!binding) {
    await retireAuthBinding(provider);
    window.location.replace("index.html?auth=failed");
    return;
  }
  try {
    const response = await nativeFetchWithTimeout(`${PUBLIC_ORIGIN}/api/v1/auth/handoff`, {
      method: "POST",
      headers: {Accept: "application/json", "Content-Type": "application/json"},
      body: JSON.stringify({handoff, binding}),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("handoff refused");
    const body = await response.json() as {session?: unknown};
    if (!isSessionToken(body.session)) throw new Error("invalid native session");
    const session = String(body.session);
    // Do not expose a session to the in-process fetch interceptor until the
    // platform secure store confirms persistence. Otherwise a Keychain/Keystore
    // write failure could redirect to auth=failed while this process still acts
    // authenticated until restart.
    await hostStorage.setItem(NATIVE_SESSION_KEY, session);
    nativeSession = session;
    await retireAuthBinding(provider);
    window.location.replace("index.html");
  } catch {
    await retireAuthBinding(provider);
    window.location.replace("index.html?auth=failed");
  }
}

async function routeAppLink(value: string | undefined): Promise<void> {
  if (!value) return;
  const auth = parseNativeAuthLink(value);
  if (auth) {
    if ("handoff" in auth && typeof auth.handoff === "string") {
      // Capacitor can surface one cold-start URL through both getLaunchUrl() and
      // appUrlOpen. Keep a small replay window so that duplicate is ignored,
      // without letting arbitrary custom-scheme deliveries grow memory forever.
      if (!rememberAuthHandoff(auth.handoff)) return;
      await acceptNativeHandoff(auth.provider, auth.handoff);
    } else {
      await retireAuthBinding(auth.provider);
      window.location.replace("index.html?auth=failed");
    }
    return;
  }
  const link = parseRoomLink(value);
  if (link) {
    // Legacy `n=` room labels remain parseable so an old signed invitation is
    // not rejected, but the installed app deliberately does not carry that
    // personal label into its bundled room URL.
    openRoom(link.token, link.mode);
  }
}

async function applyNativeChrome(): Promise<void> {
  if (!isNative) return;
  // Capacitor's Style.Dark value is light foreground content for a dark
  // background; Style.Light is dark foreground content for a light background.
  // The room is deliberately always dark, while the dashboard is light-first.
  const roomPage = /(?:^|\/)room\.html$/.test(location.pathname);
  try {
    await StatusBar.setStyle({style: roomPage ? Style.Dark : Style.Light});
  } catch { /* a status-bar cosmetic failure must never block the call */ }
}

function prepareLocalContentChrome(event: MouseEvent): void {
  if (!isNative || !(event.target instanceof Element)) return;
  const anchor = event.target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  try {
    const url = new URL(anchor.href, location.href);
    const page = url.pathname.split("/").pop() || "";
    if (url.origin === location.origin && LOCAL_DARK_CONTENT.has(page)) {
      void StatusBar.setStyle({style: Style.Dark}).catch(() => {});
    }
  } catch { /* malformed links navigate/fail normally */ }
}

window.LinguaNative = {
  isNative,
  publicOrigin: PUBLIC_ORIGIN,
  apiPath: nativeApiPath,
  websocketPath: token => websocketPath(token, true),
  isRoomToken,
  ready: () => compatibilityReady,
  getItem: key => hostStorage.getItem(key),
  setItem: (key, value) => hostStorage.setItem(key, value),
  removeItem: key => hostStorage.removeItem(key),
  async share(value) {
    try {
      await Share.share(value);
      return true;
    } catch {
      return false;
    }
  },
  openRoom,
};

if (isNative) {
  void applyNativeChrome();
  document.addEventListener("click", prepareLocalContentChrome, {capture: true});
  App.addListener("appUrlOpen", event => { void routeAppLink(event.url); });
  App.addListener("appStateChange", state => {
    if (state.isActive) void applyNativeChrome();
    window.dispatchEvent(new CustomEvent("lingua-app-state", { detail: state }));
  });
  App.getLaunchUrl().then(value => { void routeAppLink(value?.url); }).catch(() => {});
}

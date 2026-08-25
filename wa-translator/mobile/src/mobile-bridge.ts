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
const NATIVE_AUTH_BINDING_PREFIX = "lingua-relay.native-auth-binding.v2.";
const NATIVE_AUTH_START = /^\/auth\/(google|apple|facebook)\/start$/;
const SESSION_API_PATHS = new Set([
  "/api/v1/me", "/api/v1/rooms", "/api/v1/account/delete", "/api/v1/auth/logout"
]);
const LOCAL_DARK_CONTENT = new Set(["privacy.html", "terms.html", "support.html"]);
let nativeSession: string | null = null;
const memoryAuthBindings = new Map<string, string>();
const handledAuthHandoffs = new Set<string>();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function authBindingKey(provider: string): string {
  return `${NATIVE_AUTH_BINDING_PREFIX}${provider}`;
}

function saveAuthBinding(provider: string, binding: string): void {
  memoryAuthBindings.set(provider, binding);
  try { localStorage.setItem(authBindingKey(provider), binding); } catch { /* memory fallback */ }
}

function readAuthBinding(provider: string): string | null {
  try {
    const stored = localStorage.getItem(authBindingKey(provider));
    if (stored) return stored;
  } catch { /* memory fallback */ }
  return memoryAuthBindings.get(provider) || null;
}

function clearAuthBinding(provider: string): void {
  memoryAuthBindings.delete(provider);
  try { localStorage.removeItem(authBindingKey(provider)); } catch { /* already unusable */ }
}

function nativeApiPath(path: string): string {
  const resolved = apiPath(path, true);
  const provider = path.match(NATIVE_AUTH_START)?.[1];
  if (!provider) return resolved;
  // A custom URL scheme is the reliable browser-to-app return on iOS, but a
  // scheme can be claimed by another installed app. Bind every handoff to 256
  // random bits that remain only in this app; an intercepted URL is useless
  // without the matching binding during the one-time exchange.
  const binding = base64url(crypto.getRandomValues(new Uint8Array(32)));
  saveAuthBinding(provider, binding);
  return `${resolved}?binding=${encodeURIComponent(binding)}`;
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
  // already carry their own room-scoped Authorization credentials.
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await sessionReady;
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
  const response = await fetch(`${PUBLIC_ORIGIN}/api/v1/mobile/bootstrap`, {
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
  const binding = readAuthBinding(provider);
  if (!binding) {
    window.location.replace("index.html?auth=failed");
    return;
  }
  try {
    const response = await nativeFetch(`${PUBLIC_ORIGIN}/api/v1/auth/handoff`, {
      method: "POST",
      headers: {Accept: "application/json", "Content-Type": "application/json"},
      body: JSON.stringify({handoff, binding}),
      cache: "no-store",
    });
    if (!response.ok) {
      clearAuthBinding(provider);
      throw new Error("handoff refused");
    }
    const body = await response.json() as {session?: unknown};
    if (!isSessionToken(body.session)) {
      clearAuthBinding(provider);
      throw new Error("invalid native session");
    }
    nativeSession = String(body.session);
    await hostStorage.setItem(NATIVE_SESSION_KEY, nativeSession);
    clearAuthBinding(provider);
    window.location.replace("index.html");
  } catch {
    window.location.replace("index.html?auth=failed");
  }
}

async function routeAppLink(value: string | undefined): Promise<void> {
  if (!value) return;
  const auth = parseNativeAuthLink(value);
  if (auth) {
    if ("handoff" in auth && typeof auth.handoff === "string") {
      // A cold start can surface the same URL through both getLaunchUrl() and
      // appUrlOpen. The handoff is one-time, so process a given value once or a
      // successful first exchange can be followed by a misleading failure.
      if (handledAuthHandoffs.has(auth.handoff)) return;
      handledAuthHandoffs.add(auth.handoff);
      await acceptNativeHandoff(auth.provider, auth.handoff);
    } else {
      clearAuthBinding(auth.provider);
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

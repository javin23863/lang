import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
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
      openRoom(token: string, mode?: string, name?: string): boolean;
    };
  }
}

const isNative = Capacitor.isNativePlatform();
const hostStorage = createSecureHostStorage(SecureStorage);
const nativeFetch = window.fetch.bind(window);
const NATIVE_SESSION_KEY = "lingua-relay.native-session.v1";
const SESSION_API_PATHS = new Set([
  "/api/v1/me", "/api/v1/rooms", "/api/v1/account/delete", "/api/v1/auth/logout"
]);
let nativeSession: string | null = null;

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
    if (url.origin === PUBLIC_ORIGIN && SESSION_API_PATHS.has(url.pathname)
        && nativeSession && !request.headers.has("Authorization")) {
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${nativeSession}`);
      request = new Request(request, {headers});
    }
    const response = await nativeFetch(request);
    if (response.ok && request.method === "POST"
        && (url.pathname === "/api/v1/auth/logout"
          || url.pathname === "/api/v1/account/delete")) {
      nativeSession = null;
      await hostStorage.removeItem(NATIVE_SESSION_KEY).catch(() => {});
    }
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

function openRoom(token: string, mode?: string, name?: string): boolean {
  if (!isRoomToken(token)) return false;
  window.location.replace(roomPageUrl(token, mode, name));
  return true;
}

async function acceptNativeHandoff(handoff: string): Promise<void> {
  try {
    const response = await nativeFetch(`${PUBLIC_ORIGIN}/api/v1/auth/handoff`, {
      method: "POST",
      headers: {Accept: "application/json", "Content-Type": "application/json"},
      body: JSON.stringify({handoff}),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("handoff refused");
    const body = await response.json() as {session?: unknown};
    if (!isSessionToken(body.session)) throw new Error("invalid native session");
    nativeSession = String(body.session);
    await hostStorage.setItem(NATIVE_SESSION_KEY, nativeSession);
    window.location.replace("index.html");
  } catch {
    window.location.replace("index.html?auth=failed");
  }
}

async function routeAppLink(value: string | undefined): Promise<void> {
  if (!value) return;
  const auth = parseNativeAuthLink(value);
  if (auth) {
    const handoff = "handoff" in auth && typeof auth.handoff === "string" ? auth.handoff : null;
    if (handoff) await acceptNativeHandoff(handoff);
    else window.location.replace("index.html?auth=failed");
    return;
  }
  const link = parseRoomLink(value);
  if (link) {
    const name = "name" in link && typeof link.name === "string" ? link.name : undefined;
    openRoom(link.token, link.mode, name);
  }
}

window.LinguaNative = {
  isNative,
  publicOrigin: PUBLIC_ORIGIN,
  apiPath: path => apiPath(path, true),
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
  App.addListener("appUrlOpen", event => { void routeAppLink(event.url); });
  App.addListener("appStateChange", state => {
    window.dispatchEvent(new CustomEvent("lingua-app-state", { detail: state }));
  });
  App.getLaunchUrl().then(value => { void routeAppLink(value?.url); }).catch(() => {});
}

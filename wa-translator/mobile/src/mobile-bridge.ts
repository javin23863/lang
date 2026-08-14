import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

import {
  MOBILE_BUILD, PUBLIC_ORIGIN, apiPath, isRoomToken, parseRoomLink, roomPageUrl,
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
      openRoom(token: string): boolean;
    };
  }
}

const isNative = Capacitor.isNativePlatform();
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

function openRoom(token: string): boolean {
  if (!isRoomToken(token)) return false;
  window.location.replace(roomPageUrl(token));
  return true;
}

function routeAppLink(value: string | undefined): void {
  const token = value ? parseRoomLink(value) : null;
  if (token) openRoom(token);
}

window.LinguaNative = {
  isNative,
  publicOrigin: PUBLIC_ORIGIN,
  apiPath: path => apiPath(path, true),
  websocketPath: token => websocketPath(token, true),
  isRoomToken,
  ready: () => compatibilityReady,
  async getItem(key) {
    const value = await SecureStorage.get(key);
    return typeof value === "string" ? value : null;
  },
  async setItem(key, value) {
    await SecureStorage.set(key, value);
  },
  async removeItem(key) {
    await SecureStorage.remove(key);
  },
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
  App.addListener("appUrlOpen", event => routeAppLink(event.url));
  App.addListener("appStateChange", state => {
    window.dispatchEvent(new CustomEvent("lingua-app-state", { detail: state }));
  });
  App.getLaunchUrl().then(value => routeAppLink(value?.url)).catch(() => {});
}

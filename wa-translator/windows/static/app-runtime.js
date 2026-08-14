(() => {
  "use strict";
  const native = window.LinguaNative?.isNative === true;
  const publicOrigin = native ? window.LinguaNative.publicOrigin : location.origin;
  const hostRoomKey = "live-translator.host-room.v1";

  function apiUrl(path) {
    const resolved = native ? window.LinguaNative.apiPath(path) : path;
    return new URL(resolved, publicOrigin).toString();
  }

  function websocketUrl(token) {
    const base = new URL(publicOrigin);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = native ? window.LinguaNative.websocketPath(token) : `/ws/${token}`;
    return base.toString();
  }

  function roomToken() {
    if (native) {
      const token = new URLSearchParams(location.search).get("room") || "";
      return window.LinguaNative.isRoomToken(token) ? token : null;
    }
    return location.pathname.match(/^\/room\/([^/]+)$/)?.[1] || null;
  }

  function inviteUrl(room) {
    const path = typeof room === "string" ? room : room?.path;
    return new URL(path, publicOrigin).toString();
  }

  async function loadHostRoom() {
    try {
      return native
        ? await window.LinguaNative.getItem(hostRoomKey)
        : localStorage.getItem(hostRoomKey);
    } catch {
      return null;
    }
  }

  async function saveHostRoom(value) {
    try {
      if (native) await window.LinguaNative.setItem(hostRoomKey, value);
      else localStorage.setItem(hostRoomKey, value);
      return true;
    } catch {
      return false;
    }
  }

  async function forgetHostRoom() {
    try {
      if (native) await window.LinguaNative.removeItem(hostRoomKey);
      else localStorage.removeItem(hostRoomKey);
    } catch { /* an expired server token still fails closed */ }
  }

  async function share(value) {
    if (native) return window.LinguaNative.share(value);
    if (!navigator.share) return false;
    try {
      await navigator.share(value);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return true;
      return false;
    }
  }

  function openRoom(room) {
    const token = String((typeof room === "string" ? room : room?.path) || "")
      .split("/").filter(Boolean).pop();
    if (native) return window.LinguaNative.openRoom(token);
    const opened = window.open("about:blank", "_blank");
    if (!opened) return false;
    opened.opener = null;
    opened.location.replace(inviteUrl(room));
    return true;
  }

  function ready() {
    return native ? window.LinguaNative.ready() : Promise.resolve(true);
  }

  window.LinguaRuntime = Object.freeze({
    isNative: native, publicOrigin, apiUrl, websocketUrl, roomToken, inviteUrl,
    loadHostRoom, saveHostRoom, forgetHostRoom, share, openRoom, ready,
  });
})();

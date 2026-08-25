(() => {
  "use strict";

  const MODES = new Set(["voice", "chat", "video"]);

  function create(runtime) {
    if (!runtime || typeof runtime.inviteUrl !== "function"
        || typeof runtime.loadHostRoom !== "function"
        || typeof runtime.saveHostRoom !== "function"
        || typeof runtime.forgetHostRoom !== "function") {
      throw new TypeError("dashboard room model runtime is required");
    }

    function normalizeMode(value) {
      return MODES.has(value) ? value : "video";
    }

    function mode(room) {
      return normalizeMode(room?.mode);
    }

    function inviteUrl(room) {
      const url = new URL(runtime.inviteUrl(room));
      const selected = mode(room);
      if (selected !== "video") url.searchParams.set("m", selected);
      // The bearer URL carries only its room credential plus presentation mode.
      // Never promote account/device labels into a shareable capability URL.
      return url.toString();
    }

    function valid(value) {
      return value && typeof value.path === "string" && typeof value.host_control === "string"
        && Number.isSafeInteger(value.expires_at);
    }

    async function load() {
      try {
        const value = JSON.parse(await runtime.loadHostRoom() || "null");
        return valid(value) ? value : null;
      } catch (_) {
        return null;
      }
    }

    async function save(room) {
      if (!valid(room)) return false;
      try {
        return await runtime.saveHostRoom(JSON.stringify(room));
      } catch (_) {
        return false;
      }
    }

    async function forget() {
      await runtime.forgetHostRoom();
    }

    return Object.freeze({normalizeMode, mode, inviteUrl, valid, load, save, forget});
  }

  Object.defineProperty(window, "LinguaDashboardRoomModel", {
    value: Object.freeze({create}),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();

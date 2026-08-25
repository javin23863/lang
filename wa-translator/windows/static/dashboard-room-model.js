(() => {
  "use strict";

  const MODES = new Set(["voice", "chat", "video"]);
  const ROOM_PATH_PATTERN = /^\/room\/([A-Za-z0-9_-]{24})\.(\d{10})\.[A-Za-z0-9_-]{43}$/;
  const HOST_CONTROL_PATTERN = /^hc1\.([A-Za-z0-9_-]{24})\.(\d{10})\.[A-Za-z0-9_-]{43}$/;
  const REVOKED_RECORD = '{"revoked":true}';

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
      if (!valid(room)) throw new TypeError("invalid room capability");
      const url = new URL(runtime.inviteUrl(room));
      const selected = mode(room);
      if (selected !== "video") url.searchParams.set("m", selected);
      // The bearer URL carries only its room credential plus presentation mode.
      // Never promote account/device labels into a shareable capability URL.
      return url.toString();
    }

    function valid(value) {
      if (!value || typeof value.path !== "string" || typeof value.host_control !== "string"
          || !Number.isSafeInteger(value.expires_at)) return false;
      const room = ROOM_PATH_PATTERN.exec(value.path);
      const control = HOST_CONTROL_PATTERN.exec(value.host_control);
      if (!room || !control) return false;
      const expires = String(value.expires_at);
      return room[1] === control[1] && room[2] === control[2] && room[2] === expires;
    }

    async function load() {
      let persisted;
      try {
        persisted = await runtime.loadHostRoom();
      } catch (_) {
        return null;
      }
      if (!persisted) return null;
      try {
        const value = JSON.parse(persisted);
        if (valid(value)) return value;
      } catch (_) {}
      try {
        await runtime.forgetHostRoom();
      } catch (_) {}
      return null;
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
      // Overwrite the bearer with a checked invalid tombstone before best-effort
      // deletion. This makes silent native deletion failure safe: once the write
      // succeeds, no usable host-control capability remains at rest.
      let retired = false;
      try {
        retired = await runtime.saveHostRoom(REVOKED_RECORD) === true;
      } catch (_) {}
      try {
        await runtime.forgetHostRoom();
      } catch (_) {}
      return retired;
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
(() => {
  "use strict";

  const EVENT_FIELDS = Object.freeze({
    "app.open": new Set(["surface", "native"]),
    "auth.state": new Set(["state", "provider_count"]),
    "room.create.intent": new Set(["mode"]),
    "room.create.result": new Set(["mode", "result"]),
    "invite.share.intent": new Set(["method", "mode"]),
    "room.open.intent": new Set(["mode"]),
    "room.close.result": new Set(["result"]),
    "locale.change": new Set(["locale"]),
  });

  const FORBIDDEN_FIELD = /(url|uri|path|room|token|secret|name|email|message|text|caption|transcript|content)/i;
  const SAFE_VALUE = /^[A-Za-z0-9._-]{1,32}$/;

  function normalizedProperties(name, properties) {
    const allowed = EVENT_FIELDS[name];
    if (!allowed || properties === null || Array.isArray(properties) || typeof properties !== "object") {
      return null;
    }
    const clean = {};
    for (const [key, value] of Object.entries(properties)) {
      if (!allowed.has(key) || FORBIDDEN_FIELD.test(key)) return null;
      if (typeof value === "boolean") {
        clean[key] = value;
        continue;
      }
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000) {
        clean[key] = value;
        continue;
      }
      if (typeof value === "string" && SAFE_VALUE.test(value)) {
        clean[key] = value;
        continue;
      }
      return null;
    }
    return clean;
  }

  function emit(name, properties = {}) {
    const clean = normalizedProperties(name, properties);
    if (!clean) return false;
    window.dispatchEvent(new CustomEvent("lingua:product-event", {
      detail: Object.freeze({name, properties: Object.freeze(clean)}),
    }));
    return true;
  }

  const telemetry = Object.freeze({emit, events: Object.freeze(Object.keys(EVENT_FIELDS))});
  Object.defineProperty(window, "LinguaProductEvents", {
    value: telemetry,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  const path = location.pathname;
  const surface = path === "/" || path.endsWith("/index.html") ? "dashboard" : "other";
  emit("app.open", {surface, native: Boolean(window.LinguaRuntime?.isNative)});
})();

(() => {
  "use strict";

  const native = window.LinguaNative?.isNative === true;
  const roomRoute = /^\/room\/[^/]+$/.test(location.pathname);
  const ROOM_CONTROL_FETCH_TIMEOUT_MS = 12000;
  const ROOM_CONTROL_PATHS = new Set([
    "/api/capabilities",
    "/api/turn",
    "/api/room",
    "/api/reports",
  ]);

  // app-runtime.js installs the browser TURN Retry-After policy before this
  // deferred loader runs. Capture that wrapped fetch rather than replacing it,
  // so room control deadlines and TURN quota backoff compose in one chain.
  if (!native && roomRoute && typeof window.fetch === "function") {
    const boundedFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      let url;
      try {
        const target = typeof Request !== "undefined" && input instanceof Request
          ? input.url : input;
        url = new URL(target, location.href);
      } catch {
        return boundedFetch(input, init);
      }

      if (url.origin !== location.origin || !ROOM_CONTROL_PATHS.has(url.pathname)) {
        return boundedFetch(input, init);
      }

      const callerSignal = init.signal
        || (typeof Request !== "undefined" && input instanceof Request ? input.signal : null);
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      if (callerSignal?.aborted) abortFromCaller();
      else callerSignal?.addEventListener("abort", abortFromCaller, {once: true});
      const timer = setTimeout(() => controller.abort(), ROOM_CONTROL_FETCH_TIMEOUT_MS);

      try {
        return await boundedFetch(input, {...init, signal: controller.signal});
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abortFromCaller);
      }
    };
  }

  // Keep /qr.js as the public loader used by existing dashboard/room markup.
  // Disable the user-facing QR control until the unchanged encoder is ready so
  // a slow first fetch cannot turn an early click into a LinguaQR reference error.
  const qrButton = document.getElementById("qrBtn");
  if (qrButton) qrButton.disabled = true;
  const qrCore = document.createElement("script");
  qrCore.src = "/qr-encoder.js";
  qrCore.async = false;
  qrCore.addEventListener("load", () => {
    if (qrButton) qrButton.disabled = false;
  }, {once: true});
  document.head.appendChild(qrCore);
})();

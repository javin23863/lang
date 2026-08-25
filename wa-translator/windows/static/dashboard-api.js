(() => {
  "use strict";

  const REQUEST_TIMEOUT_MS = 15_000;

  async function fetchWithDeadline(input, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(input, {...init, signal: controller.signal});
    } finally {
      clearTimeout(timer);
    }
  }

  Object.defineProperty(window, "LinguaDashboardApi", {
    value: Object.freeze({fetch: fetchWithDeadline, timeoutMs: REQUEST_TIMEOUT_MS}),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();

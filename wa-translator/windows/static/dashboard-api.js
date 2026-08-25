(() => {
  "use strict";

  const REQUEST_TIMEOUT_MS = 15_000;

  async function fetchWithDeadline(input, init = {}) {
    const controller = new AbortController();
    const callerSignal = init.signal;
    let detachCaller = () => {};
    if (callerSignal) {
      const abortFromCaller = () => controller.abort(callerSignal.reason);
      if (callerSignal.aborted) abortFromCaller();
      else {
        callerSignal.addEventListener("abort", abortFromCaller, {once: true});
        detachCaller = () => callerSignal.removeEventListener("abort", abortFromCaller);
      }
    }
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(input, {...init, signal: controller.signal});
    } finally {
      clearTimeout(timer);
      detachCaller();
    }
  }

  Object.defineProperty(window, "LinguaDashboardApi", {
    value: Object.freeze({fetch: fetchWithDeadline, timeoutMs: REQUEST_TIMEOUT_MS}),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();

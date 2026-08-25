(() => {
  "use strict";

  function create({runtime, onVisible}) {
    if (!runtime || typeof runtime.ready !== "function" || typeof onVisible !== "function") {
      throw new TypeError("dashboard lifecycle dependencies are required");
    }

    function install() {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onVisible();
      });
      if (!runtime.isNative && "serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }
    }

    async function ready() {
      await runtime.ready();
    }

    return Object.freeze({install, ready});
  }

  Object.defineProperty(window, "LinguaDashboardLifecycle", {
    value: Object.freeze({create}),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();

(() => {
  "use strict";

  function create({runtime, onVisible}) {
    if (!runtime || typeof runtime.ready !== "function" || typeof onVisible !== "function") {
      throw new TypeError("dashboard lifecycle dependencies are required");
    }

    function recoverWhenUsable() {
      if (document.visibilityState === "visible") onVisible();
    }

    function install() {
      document.addEventListener("visibilitychange", recoverWhenUsable);
      window.addEventListener("online", recoverWhenUsable);
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

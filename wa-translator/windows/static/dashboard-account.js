(() => {
  "use strict";

  const PROVIDERS = Object.freeze([
    ["google", "signInGoogle"],
    ["apple", "signInApple"],
    ["facebook", "signInFacebook"],
  ]);
  const USAGE_KIND = Object.freeze({
    call: "credits.callMinutes",
    chat: "credits.chatMessages",
    tts: "credits.ttsPhrases",
  });

  function create({runtime, fetch: dashboardFetch, t, byId}) {
    if (!runtime || typeof dashboardFetch !== "function" || typeof t !== "function"
        || typeof byId !== "function") {
      throw new TypeError("dashboard account presenter dependencies are required");
    }

    async function load() {
      try {
        // Browser sessions ride same-origin cookies. The native bridge attaches
        // its securely stored bearer only to the versioned account API.
        const response = await dashboardFetch(runtime.apiUrl("/api/me"), {
          headers: {Accept: "application/json"},
        });
        if (!response.ok) throw new Error("account unavailable");
        return await response.json();
      } catch (_) {
        // A failed account snapshot still produces a usable signed-out screen;
        // it never strands the app in its loading state.
        return {signed_in: false, providers: []};
      }
    }

    function renderProviders(account) {
      const offered = Array.isArray(account?.providers) ? account.providers : [];
      const box = byId("authButtons");
      box.replaceChildren();
      for (const [provider, id] of PROVIDERS) {
        if (!offered.includes(provider)) continue;
        const link = document.createElement("a");
        link.id = id;
        link.className = "signIn";
        link.href = runtime.apiUrl("/auth/" + provider + "/start");
        link.dataset.i18n = "auth." + id;
        link.textContent = t(link.dataset.i18n);
        box.appendChild(link);
      }
    }

    function render(account) {
      if (!account) return;
      document.body.dataset.auth = account.signed_in ? "in" : "out";
      renderProviders(account);
      if (!account.signed_in) return;

      byId("accountName").textContent = t("auth.signedInAs", {name: account.user?.name || ""});
      const rows = Array.isArray(account.recent) ? account.recent.slice(0, 20) : [];
      const list = byId("usageList");
      list.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement("li");
        empty.textContent = t("credits.usageEmpty");
        list.appendChild(empty);
        return;
      }

      for (const row of rows) {
        const item = document.createElement("li");
        const when = document.createElement("span");
        when.className = "when";
        const at = new Date(row.at);
        when.textContent = Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString(runtime.i18n.locale);
        const what = document.createElement("span");
        what.textContent = USAGE_KIND[row.kind]
          ? t(USAGE_KIND[row.kind], {count: Number(row.units) || 0})
          : String(row.units);
        item.append(when, what);
        list.appendChild(item);
      }
    }

    return Object.freeze({load, render});
  }

  Object.defineProperty(window, "LinguaDashboardAccount", {
    value: Object.freeze({create}),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();

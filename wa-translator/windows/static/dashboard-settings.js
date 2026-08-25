(() => {
  "use strict";

  function create({runtime, byId}) {
    if (!runtime?.i18n || typeof byId !== "function") {
      throw new TypeError("dashboard settings dependencies are required");
    }

    function languageName(code) {
      let label = code;
      try {
        label = new Intl.DisplayNames([code], {type: "language"}).of(code) || code;
      } catch (_) { /* an unknown tag keeps its code */ }
      return label.charAt(0).toLocaleUpperCase(code) + label.slice(1);
    }

    function fillLanguageSelect() {
      const select = byId("appLocaleSel");
      const named = runtime.i18n.languages
        .map(code => ({code, label: languageName(code)}))
        .sort((left, right) => left.label.localeCompare(right.label));
      select.replaceChildren();
      for (const {code, label} of named) {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = label;
        option.selected = code === runtime.i18n.language;
        select.appendChild(option);
      }
    }

    function install(onLanguageChange) {
      if (typeof onLanguageChange !== "function") {
        throw new TypeError("dashboard language repaint callback is required");
      }
      fillLanguageSelect();
      byId("appLocaleSel").onchange = () => runtime.i18n.use(byId("appLocaleSel").value);
      runtime.i18n.onChange(() => {
        byId("appLocaleSel").value = runtime.i18n.language;
        onLanguageChange();
      });
    }

    return Object.freeze({install, fillLanguageSelect});
  }

  Object.defineProperty(window, "LinguaDashboardSettings", {
    value: Object.freeze({create}),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();

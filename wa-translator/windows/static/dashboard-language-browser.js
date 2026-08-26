(() => {
  "use strict";
  const screen = document.getElementById("screenLanguages");
  const source = document.getElementById("appLocaleSel");
  if (!screen || !source || document.getElementById("languageBrowser")) return;

  const MY_KEY = "lingua-relay.setup.my-language";
  const THEIR_KEY = "lingua-relay.setup.their-language";
  const FAVORITES_KEY = "lingua-relay.favorite-languages.v1";
  const RECENT_KEY = "lingua-relay.recent-languages.v1";
  let target = "mine";

  const browser = document.createElement("section");
  browser.id = "languageBrowser";
  browser.className = "screenCard languageBrowser";
  browser.innerHTML = `
    <div class="sectionLabelRow"><strong>Browse languages</strong><span>Search 100+</span></div>
    <div class="languageTargetSwitch" role="tablist" aria-label="Language target">
      <button type="button" class="selected" data-language-target="mine" role="tab" aria-selected="true">I speak</button>
      <button type="button" data-language-target="theirs" role="tab" aria-selected="false">They speak</button>
    </div>
    <div id="languageQuick" class="languageQuick"></div>
    <label class="languageSearch"><span class="srOnly">Search languages</span><input id="languageSearchInput" type="search" placeholder="Search languages" autocomplete="off" spellcheck="false"></label>
    <div id="languageBrowseList" class="languageBrowseList" role="listbox" aria-label="Languages"></div>
  `;
  screen.append(browser);

  const input = document.getElementById("languageSearchInput");
  const list = document.getElementById("languageBrowseList");
  const quick = document.getElementById("languageQuick");

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
    } catch (_) {
      return [];
    }
  }
  function writeArray(key, values) {
    try { localStorage.setItem(key, JSON.stringify(values)); } catch (_) {}
  }
  function currentValue() {
    try { return localStorage.getItem(target === "mine" ? MY_KEY : THEIR_KEY) || ""; }
    catch { return ""; }
  }
  function options() {
    return [...source.options]
      .map(option => ({value: option.value, label: option.textContent?.trim() || option.value}))
      .filter(option => option.value && option.label);
  }
  function optionMap() {
    return new Map(options().map(option => [option.value, option]));
  }

  function renderQuick() {
    const lookup = optionMap();
    const favorites = readArray(FAVORITES_KEY).filter(value => lookup.has(value));
    const currentPair = [
      (() => { try { return localStorage.getItem(MY_KEY) || ""; } catch (_) { return ""; } })(),
      (() => { try { return localStorage.getItem(THEIR_KEY) || ""; } catch (_) { return ""; } })(),
    ].filter(Boolean);
    const recent = [...new Set([...currentPair, ...readArray(RECENT_KEY)])]
      .filter(value => lookup.has(value) && !favorites.includes(value)).slice(0, 6);

    quick.replaceChildren();
    const makeGroup = (title, values, favorite = false) => {
      if (!values.length) return;
      const section = document.createElement("section");
      section.className = "languageQuickGroup";
      const label = document.createElement("span");
      label.className = "languageQuickLabel";
      label.textContent = title;
      const chips = document.createElement("div");
      chips.className = "languageQuickChips";
      for (const value of values) {
        const option = lookup.get(value);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "languageQuickChip";
        button.dataset.value = value;
        button.innerHTML = `${favorite ? '<span aria-hidden="true">★</span>' : ""}<strong>${option.label}</strong>`;
        button.addEventListener("click", () => choose(value));
        chips.append(button);
      }
      section.append(label, chips);
      quick.append(section);
    };
    makeGroup("Favorites", favorites, true);
    makeGroup("Recent", recent);
    quick.hidden = !quick.childElementCount;
  }

  function toggleFavorite(value) {
    const favorites = readArray(FAVORITES_KEY);
    const next = favorites.includes(value)
      ? favorites.filter(item => item !== value)
      : [value, ...favorites.filter(item => item !== value)].slice(0, 12);
    writeArray(FAVORITES_KEY, next);
    render();
  }

  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    const active = currentValue();
    const favorites = new Set(readArray(FAVORITES_KEY));
    const matches = options().filter(option => !query || option.label.toLocaleLowerCase().includes(query));
    list.replaceChildren();
    renderQuick();
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "languageSearchEmpty";
      empty.textContent = "No matching languages";
      list.append(empty);
      return;
    }
    for (const option of matches) {
      const item = document.createElement("div");
      item.className = "languageBrowseItem";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "languageBrowseRow";
      button.dataset.value = option.value;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === active));
      button.innerHTML = `<span class="languageInitial" aria-hidden="true">${option.label.slice(0, 1).toLocaleUpperCase()}</span><span>${option.label}</span><span class="languageCheck" aria-hidden="true">✓</span>`;
      button.addEventListener("click", () => choose(option.value));
      const star = document.createElement("button");
      star.type = "button";
      star.className = "languageFavorite";
      star.dataset.favorite = option.value;
      star.setAttribute("aria-label", `${favorites.has(option.value) ? "Remove" : "Add"} ${option.label} ${favorites.has(option.value) ? "from" : "to"} favorites`);
      star.setAttribute("aria-pressed", String(favorites.has(option.value)));
      star.textContent = favorites.has(option.value) ? "★" : "☆";
      star.addEventListener("click", () => toggleFavorite(option.value));
      item.append(button, star);
      list.append(item);
    }
  }

  function choose(value) {
    try { localStorage.setItem(target === "mine" ? MY_KEY : THEIR_KEY, value); } catch (_) {}
    writeArray(RECENT_KEY, [value, ...readArray(RECENT_KEY).filter(item => item !== value)].slice(0, 8));
    const select = document.getElementById(target === "mine" ? "defaultMyLanguage" : "defaultTheirLanguage");
    if (select && [...select.options].some(option => option.value === value)) {
      select.value = value;
      select.dispatchEvent(new Event("change", {bubbles: true}));
    }
    render();
  }

  for (const button of browser.querySelectorAll("[data-language-target]")) {
    button.addEventListener("click", () => {
      target = button.dataset.languageTarget;
      for (const candidate of browser.querySelectorAll("[data-language-target]")) {
        const selected = candidate === button;
        candidate.classList.toggle("selected", selected);
        candidate.setAttribute("aria-selected", String(selected));
      }
      render();
      input.focus();
    });
  }

  input.addEventListener("input", render);
  if (typeof MutationObserver === "function") {
    new MutationObserver(render).observe(source, {childList: true});
  }
  render();
})();

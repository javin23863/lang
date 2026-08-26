(() => {
  "use strict";
  const screen = document.getElementById("screenLanguages");
  const source = document.getElementById("appLocaleSel");
  if (!screen || !source || document.getElementById("languageBrowser")) return;

  const MY_KEY = "lingua-relay.setup.my-language";
  const THEIR_KEY = "lingua-relay.setup.their-language";
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
    <label class="languageSearch"><span class="srOnly">Search languages</span><input id="languageSearchInput" type="search" placeholder="Search languages" autocomplete="off" spellcheck="false"></label>
    <div id="languageBrowseList" class="languageBrowseList" role="listbox" aria-label="Languages"></div>
  `;
  screen.append(browser);

  const input = document.getElementById("languageSearchInput");
  const list = document.getElementById("languageBrowseList");

  function currentValue() {
    try { return localStorage.getItem(target === "mine" ? MY_KEY : THEIR_KEY) || ""; }
    catch { return ""; }
  }

  function options() {
    return [...source.options]
      .map(option => ({value: option.value, label: option.textContent?.trim() || option.value}))
      .filter(option => option.value && option.label);
  }

  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    const active = currentValue();
    const matches = options().filter(option => !query || option.label.toLocaleLowerCase().includes(query));
    list.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "languageSearchEmpty";
      empty.textContent = "No matching languages";
      list.append(empty);
      return;
    }
    for (const option of matches) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "languageBrowseRow";
      button.dataset.value = option.value;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === active));
      button.innerHTML = `<span class="languageInitial" aria-hidden="true">${option.label.slice(0, 1).toLocaleUpperCase()}</span><span>${option.label}</span><span class="languageCheck" aria-hidden="true">✓</span>`;
      button.addEventListener("click", () => choose(option.value));
      list.append(button);
    }
  }

  function choose(value) {
    try { localStorage.setItem(target === "mine" ? MY_KEY : THEIR_KEY, value); } catch (_) {}
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

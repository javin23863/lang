(() => {
  "use strict";

  const setupMine = document.getElementById("setupMyLanguage");
  const setupTheirs = document.getElementById("setupTheirLanguage");
  const swapSlot = document.querySelector("#conversationSetup .languageSwap");
  const defaultMine = document.getElementById("defaultMyLanguage");
  const defaultTheirs = document.getElementById("defaultTheirLanguage");
  const languages = document.getElementById("screenLanguages");
  if (!setupMine || !setupTheirs || !swapSlot || !languages) return;

  const MY_KEY = "lingua-relay.setup.my-language";
  const THEIR_KEY = "lingua-relay.setup.their-language";

  const setupSwap = document.createElement("button");
  setupSwap.type = "button";
  setupSwap.className = "languageSwap languageSwapButton";
  setupSwap.setAttribute("aria-label", "Swap conversation languages");
  setupSwap.title = "Swap languages";
  setupSwap.textContent = "⇄";
  swapSlot.replaceWith(setupSwap);

  const defaultsCard = languages.querySelector(".conversationDefaults");
  const defaultSwap = document.createElement("button");
  defaultSwap.id = "defaultLanguageSwap";
  defaultSwap.type = "button";
  defaultSwap.className = "defaultLanguageSwap";
  defaultSwap.innerHTML = '<span aria-hidden="true">⇄</span><strong>Swap conversation languages</strong>';
  if (defaultsCard) defaultsCard.append(defaultSwap);

  function save(mine, theirs) {
    try {
      localStorage.setItem(MY_KEY, mine);
      localStorage.setItem(THEIR_KEY, theirs);
    } catch (_) {}
  }

  function swap(selectMine, selectTheirs, persist) {
    if (!selectMine || !selectTheirs) return;
    const mine = selectMine.value;
    const theirs = selectTheirs.value;
    if (!mine || !theirs || mine === theirs) return;
    if (![...selectMine.options].some(option => option.value === theirs)
        || ![...selectTheirs.options].some(option => option.value === mine)) return;
    selectMine.value = theirs;
    selectTheirs.value = mine;
    selectMine.dispatchEvent(new Event("change", {bubbles: true}));
    selectTheirs.dispatchEvent(new Event("change", {bubbles: true}));
    if (persist) save(selectMine.value, selectTheirs.value);
    window.dispatchEvent(new CustomEvent("lingua-language-pair-change", {
      detail: {mine: selectMine.value, theirs: selectTheirs.value},
    }));
  }

  setupSwap.addEventListener("click", () => swap(setupMine, setupTheirs, false));
  defaultSwap.addEventListener("click", () => swap(defaultMine, defaultTheirs, true));
})();

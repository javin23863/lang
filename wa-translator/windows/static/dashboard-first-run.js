(() => {
  "use strict";

  const COMPLETE_KEY = "lingua-relay.product-setup.v1";
  const MY_KEY = "lingua-relay.setup.my-language";
  const THEIR_KEY = "lingua-relay.setup.their-language";
  const MODE_KEY = "lingua-relay.pref.default-mode";
  const source = document.getElementById("appLocaleSel");
  if (!source || document.getElementById("firstRunSetup")) return;

  const done = () => {
    try { return localStorage.getItem(COMPLETE_KEY) === "1"; }
    catch (_) { return false; }
  };

  const layer = document.createElement("div");
  layer.id = "firstRunSetup";
  layer.className = "firstRunSetup";
  layer.hidden = true;
  layer.innerHTML = `
    <section class="firstRunCard" role="dialog" aria-modal="true" aria-labelledby="firstRunTitle">
      <div class="firstRunProgress"><span class="active"></span><span></span></div>
      <section class="firstRunStep" data-first-run-step="language">
        <div class="firstRunMark" aria-hidden="true">A↔</div>
        <p class="screenEyebrow">Welcome to Lingua Relay</p>
        <h2 id="firstRunTitle">What language do you speak?</h2>
        <p class="firstRunLead">We’ll use this as your default when you start a private conversation. You can change it anytime.</p>
        <label class="firstRunField"><span>My language</span><select id="firstRunLanguage" disabled><option>Loading languages…</option></select></label>
        <button id="firstRunNext" class="firstRunPrimary" type="button" disabled>Continue</button>
      </section>
      <section class="firstRunStep" data-first-run-step="mode" hidden>
        <div class="firstRunMark" aria-hidden="true">✦</div>
        <p class="screenEyebrow">Your default</p>
        <h2>How do you usually want to talk?</h2>
        <p class="firstRunLead">This only highlights a starting point. Video, voice, and chat are always one tap away.</p>
        <div id="firstRunModes" class="firstRunModes" role="radiogroup" aria-label="Default conversation type">
          <button type="button" data-first-mode="video" role="radio"><span aria-hidden="true">▣</span><strong>Video</strong><small>See each other with live translation</small></button>
          <button type="button" data-first-mode="voice" role="radio"><span aria-hidden="true">◉</span><strong>Voice</strong><small>Phone-style translated conversation</small></button>
          <button type="button" data-first-mode="chat" role="radio"><span aria-hidden="true">✦</span><strong>Chat</strong><small>Translated private messages</small></button>
        </div>
        <div class="firstRunActions"><button id="firstRunBack" type="button">Back</button><button id="firstRunFinish" class="firstRunPrimary" type="button">Go to Home</button></div>
      </section>
    </section>
  `;
  document.body.append(layer);

  const language = document.getElementById("firstRunLanguage");
  const next = document.getElementById("firstRunNext");
  const finish = document.getElementById("firstRunFinish");
  const progress = [...layer.querySelectorAll(".firstRunProgress span")];
  let mode = "video";

  function copyLanguages() {
    const options = [...source.options].filter(option => option.value);
    if (!options.length) return false;
    language.replaceChildren(...options.map(option => option.cloneNode(true)));
    let saved = "";
    try { saved = localStorage.getItem(MY_KEY) || source.value || ""; } catch (_) { saved = source.value || ""; }
    if (saved && [...language.options].some(option => option.value === saved)) language.value = saved;
    language.disabled = false;
    next.disabled = !language.value;
    return true;
  }

  function selectMode(value) {
    mode = ["video", "voice", "chat"].includes(value) ? value : "video";
    for (const button of layer.querySelectorAll("[data-first-mode]")) {
      const selected = button.dataset.firstMode === mode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    }
  }

  function showStep(name) {
    for (const section of layer.querySelectorAll("[data-first-run-step]")) section.hidden = section.dataset.firstRunStep !== name;
    const second = name === "mode";
    progress[0].classList.toggle("active", !second);
    progress[1].classList.toggle("active", second);
    setTimeout(() => (second ? layer.querySelector("[data-first-mode].selected") : language)?.focus?.(), 40);
  }

  function showIfNeeded() {
    if (document.body.dataset.auth !== "in" || done()) return;
    copyLanguages();
    let savedMode = "video";
    try { savedMode = localStorage.getItem(MODE_KEY) || "video"; } catch (_) {}
    selectMode(savedMode);
    layer.hidden = false;
    document.body.classList.add("firstRunOpen");
    showStep("language");
  }

  function complete() {
    if (!language.value) return;
    try {
      localStorage.setItem(MY_KEY, language.value);
      localStorage.setItem(MODE_KEY, mode);
      if (!localStorage.getItem(THEIR_KEY)) {
        const alternative = [...language.options].find(option => option.value !== language.value);
        if (alternative) localStorage.setItem(THEIR_KEY, alternative.value);
      }
      localStorage.setItem(COMPLETE_KEY, "1");
    } catch (_) {}
    const defaultMine = document.getElementById("defaultMyLanguage");
    if (defaultMine && [...defaultMine.options].some(option => option.value === language.value)) {
      defaultMine.value = language.value;
      defaultMine.dispatchEvent(new Event("change", {bubbles: true}));
    }
    layer.hidden = true;
    document.body.classList.remove("firstRunOpen");
    window.LinguaDashboardShell?.selectTab?.("home");
    window.dispatchEvent(new CustomEvent("lingua-preferences-change", {detail: {defaultMode: mode}}));
  }

  language.addEventListener("change", () => { next.disabled = !language.value; });
  next.addEventListener("click", () => showStep("mode"));
  document.getElementById("firstRunBack")?.addEventListener("click", () => showStep("language"));
  finish.addEventListener("click", complete);
  for (const button of layer.querySelectorAll("[data-first-mode]")) button.addEventListener("click", () => selectMode(button.dataset.firstMode));

  if (typeof MutationObserver === "function") {
    new MutationObserver(showIfNeeded).observe(document.body, {attributes: true, attributeFilter: ["data-auth"]});
    new MutationObserver(() => { if (!language.options.length || language.disabled) copyLanguages(); }).observe(source, {childList: true});
  }
  showIfNeeded();
})();

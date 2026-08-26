(() => {
  "use strict";
  const home = document.getElementById("screenHome");
  const hero = home?.querySelector(".productHero");
  if (!home || !hero || document.getElementById("homeQuickContext")) return;

  const MY_KEY = "lingua-relay.setup.my-language";
  const THEIR_KEY = "lingua-relay.setup.their-language";
  const RECENT_KEY = "lingua-relay.recent-conversations.v1";

  const context = document.createElement("section");
  context.id = "homeQuickContext";
  context.className = "homeQuickContext";
  context.innerHTML = `
    <button id="homeLanguagePair" class="homeContextCard" type="button">
      <span class="homeContextIcon" aria-hidden="true">A↔</span>
      <span class="homeContextCopy"><small>Your languages</small><strong id="homeLanguagePairValue">Choose language pair</strong></span>
      <span class="homeContextArrow" aria-hidden="true">›</span>
    </button>
    <button id="homeRecentShortcut" class="homeContextCard" type="button" hidden>
      <span id="homeRecentIcon" class="homeContextIcon" aria-hidden="true">▣</span>
      <span class="homeContextCopy"><small>Start again</small><strong id="homeRecentValue">Recent conversation</strong></span>
      <span class="homeContextArrow" aria-hidden="true">›</span>
    </button>
  `;
  hero.after(context);

  function selectLabel(value) {
    const source = document.getElementById("appLocaleSel");
    const option = source ? [...source.options].find(candidate => candidate.value === value) : null;
    return option?.textContent?.trim() || value || "—";
  }

  function readRecent() {
    try {
      const rows = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(rows) ? rows[0] || null : null;
    } catch (_) {
      return null;
    }
  }

  function render() {
    let mine = "", theirs = "";
    try {
      mine = localStorage.getItem(MY_KEY) || "";
      theirs = localStorage.getItem(THEIR_KEY) || "";
    } catch (_) {}
    document.getElementById("homeLanguagePairValue").textContent =
      mine || theirs ? `${selectLabel(mine)} → ${selectLabel(theirs)}` : "Choose language pair";

    const recent = readRecent();
    const shortcut = document.getElementById("homeRecentShortcut");
    if (!recent) {
      shortcut.hidden = true;
      return;
    }
    shortcut.hidden = false;
    shortcut.dataset.mode = recent.mode || "video";
    document.getElementById("homeRecentIcon").textContent = recent.mode === "voice" ? "◉" : recent.mode === "chat" ? "✦" : "▣";
    const mode = recent.mode === "voice" ? "Voice call" : recent.mode === "chat" ? "Text chat" : "Video call";
    document.getElementById("homeRecentValue").textContent = `${mode} · ${recent.mine || "—"} → ${recent.theirs || "—"}`;
  }

  document.getElementById("homeLanguagePair")?.addEventListener("click", () => {
    window.LinguaDashboardShell?.selectTab?.("languages");
  });
  document.getElementById("homeRecentShortcut")?.addEventListener("click", event => {
    window.LinguaDashboardShell?.openConversationSetup?.(event.currentTarget.dataset.mode || "video");
  });

  for (const id of ["defaultMyLanguage", "defaultTheirLanguage"]) {
    document.getElementById(id)?.addEventListener("change", render);
  }
  const recentList = document.getElementById("recentConversationList");
  if (recentList && typeof MutationObserver === "function") {
    new MutationObserver(render).observe(recentList, {childList: true});
  }
  const source = document.getElementById("appLocaleSel");
  if (source && typeof MutationObserver === "function") {
    new MutationObserver(render).observe(source, {childList: true});
  }
  window.addEventListener("storage", render);
  render();
})();

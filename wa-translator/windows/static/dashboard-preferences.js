(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const languages = byId("screenLanguages");
  const profile = byId("screenProfile");
  const source = byId("appLocaleSel");
  if (!languages || !profile || !source) return;

  const MY_KEY = "lingua-relay.setup.my-language";
  const THEIR_KEY = "lingua-relay.setup.their-language";

  const defaults = document.createElement("section");
  defaults.className = "screenCard conversationDefaults";
  defaults.innerHTML = `
    <div class="sectionLabelRow"><strong>Conversation defaults</strong><span>Used when you start a room</span></div>
    <div class="conversationDefaultGrid">
      <label><span>I speak</span><select id="defaultMyLanguage"></select></label>
      <button id="swapDefaultLanguages" type="button" aria-label="Swap conversation languages">⇄</button>
      <label><span>Translate for</span><select id="defaultTheirLanguage"></select></label>
    </div>
    <p class="conversationDefaultsNote">You can change either language again before every call or chat.</p>
  `;
  const pickerCard = languages.querySelector(".languagePickerCard");
  if (pickerCard) pickerCard.before(defaults);
  else languages.append(defaults);

  const mySelect = byId("defaultMyLanguage");
  const theirSelect = byId("defaultTheirLanguage");

  function hasValue(select, value) {
    return Boolean(value && [...select.options].some(option => option.value === value));
  }

  function syncOptions() {
    if (!source.options.length) return;
    const my = mySelect.value || localStorage.getItem(MY_KEY) || source.value;
    const theirs = theirSelect.value || localStorage.getItem(THEIR_KEY) || "";
    const clones = () => [...source.options].map(option => option.cloneNode(true));
    mySelect.replaceChildren(...clones());
    theirSelect.replaceChildren(...clones());
    if (hasValue(mySelect, my)) mySelect.value = my;
    if (hasValue(theirSelect, theirs)) theirSelect.value = theirs;
    else {
      const alternative = [...theirSelect.options].find(option => option.value !== mySelect.value);
      if (alternative) theirSelect.value = alternative.value;
    }
    persist();
  }

  function persist() {
    try {
      if (mySelect.value) localStorage.setItem(MY_KEY, mySelect.value);
      if (theirSelect.value) localStorage.setItem(THEIR_KEY, theirSelect.value);
    } catch (_) {}
  }

  mySelect.addEventListener("change", persist);
  theirSelect.addEventListener("change", persist);
  byId("swapDefaultLanguages")?.addEventListener("click", () => {
    const mine = mySelect.value;
    const theirs = theirSelect.value;
    if (hasValue(mySelect, theirs)) mySelect.value = theirs;
    if (hasValue(theirSelect, mine)) theirSelect.value = mine;
    persist();
  });

  if (typeof MutationObserver === "function") {
    new MutationObserver(syncOptions).observe(source, {childList: true});
  }
  syncOptions();

  const deviceCard = document.createElement("section");
  deviceCard.className = "screenCard profileDeviceCard";
  const installed = window.LinguaRuntime?.isNative === true;
  deviceCard.innerHTML = `
    <div class="sectionLabelRow"><strong>App & privacy</strong><span>${installed ? "Installed app" : "Web app"}</span></div>
    <div class="profileInfoRow"><span class="profileInfoIcon" aria-hidden="true">2</span><div><strong>Two-person private rooms</strong><p>Every conversation room is limited to two people.</p></div></div>
    <div class="profileInfoRow"><span class="profileInfoIcon" aria-hidden="true">◎</span><div><strong>Permissions when needed</strong><p>Microphone and camera access are requested only when you use those features.</p></div></div>
    <div class="profileInfoRow"><span class="profileInfoIcon" aria-hidden="true">≡</span><div><strong>No transcript shown in Activity</strong><p>Activity keeps lightweight conversation metadata, not the message or caption content.</p></div></div>
  `;
  const settings = profile.querySelector(".settingsList");
  if (settings) settings.after(deviceCard);
  else profile.append(deviceCard);

  const recentList = byId("recentConversationList");
  function activateRecentRows() {
    if (!recentList) return;
    for (const row of recentList.querySelectorAll(".recentRow")) {
      if (row.dataset.reusable === "true") continue;
      row.dataset.reusable = "true";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Start another ${row.querySelector("strong")?.textContent || "conversation"}`);
      const mode = row.querySelector(".recentModeIcon")?.dataset.mode || "video";
      const startAgain = () => {
        window.LinguaDashboardShell?.selectTab?.("home");
        window.LinguaDashboardShell?.openConversationSetup?.(mode);
      };
      row.addEventListener("click", startAgain);
      row.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        startAgain();
      });
    }
  }
  if (recentList && typeof MutationObserver === "function") {
    new MutationObserver(activateRecentRows).observe(recentList, {childList: true});
  }
  activateRecentRows();
})();

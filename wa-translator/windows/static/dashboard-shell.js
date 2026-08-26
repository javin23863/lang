(() => {
  "use strict";

  const page = document.querySelector(".page");
  const brand = document.querySelector(".brand");
  if (!page || !brand || document.getElementById("appTabs")) return;

  const byId = id => document.getElementById(id);
  const t = window.LinguaRuntime?.t || (key => key);

  const screens = document.createElement("div");
  screens.id = "appScreens";
  screens.className = "appScreens authed";

  const makeScreen = (id, title, subtitle) => {
    const section = document.createElement("section");
    section.id = id;
    section.className = "appScreen";
    section.hidden = true;

    const heading = document.createElement("header");
    heading.className = "screenHeading";
    const copy = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "screenEyebrow";
    eyebrow.textContent = "Lingua Relay";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    copy.append(eyebrow, h2);
    if (subtitle) {
      const p = document.createElement("p");
      p.className = "screenSubtitle";
      p.textContent = subtitle;
      copy.append(p);
    }
    heading.append(copy);
    section.append(heading);
    return section;
  };

  const homeScreen = makeScreen(
    "screenHome",
    "Start a conversation",
    "Speak naturally. Lingua Relay translates live voice, video, and chat.",
  );
  const activityScreen = makeScreen(
    "screenActivity",
    "Activity",
    "Recent private-room usage on this account.",
  );
  const languagesScreen = makeScreen(
    "screenLanguages",
    "Languages",
    "Choose the language used throughout the app.",
  );
  const profileScreen = makeScreen(
    "screenProfile",
    "Profile",
    "Account, privacy, support, and device preferences.",
  );

  const homeHero = document.createElement("section");
  homeHero.className = "productHero";
  homeHero.innerHTML = `
    <div class="heroBadge">Live translation</div>
    <h3>One conversation. Two languages.</h3>
    <p>Start a private video call, voice call, or translated chat and share a link with one person.</p>
  `;
  homeScreen.append(homeHero);

  const homeSurface = document.querySelector(".homeSurface");
  const roomPanel = byId("roomPanel");
  const roomNotice = byId("roomNotice");
  if (homeSurface) homeScreen.append(homeSurface);
  if (roomPanel) homeScreen.append(roomPanel);
  if (roomNotice) homeScreen.append(roomNotice);

  const credits = byId("creditsPanel");
  if (credits) {
    credits.classList.add("screenCard");
    activityScreen.append(credits);
  }

  const activityEmpty = document.createElement("section");
  activityEmpty.className = "screenCard activityNote";
  activityEmpty.innerHTML = `
    <div class="activityIcon" aria-hidden="true">↗</div>
    <div><strong>Private by default</strong><p>Conversation content is not presented here. Activity is limited to account usage and room events.</p></div>
  `;
  activityScreen.append(activityEmpty);

  const languageCard = document.createElement("section");
  languageCard.className = "screenCard languageOverview";
  languageCard.innerHTML = `
    <div class="settingRow">
      <div><strong>App language</strong><p>Menus, controls, and interface text.</p></div>
      <span class="settingBadge">100+</span>
    </div>
    <div class="settingRow">
      <div><strong>Conversation languages</strong><p>Choose your spoken language before you create a room. The other person chooses theirs when joining.</p></div>
      <span class="settingChevron" aria-hidden="true">›</span>
    </div>
  `;
  languagesScreen.append(languageCard);
  const appLocale = document.querySelector(".appLocale");
  if (appLocale) {
    appLocale.classList.add("screenCard", "languagePickerCard");
    languagesScreen.append(appLocale);
  }

  const profileSummary = document.createElement("section");
  profileSummary.className = "profileSummary screenCard";
  profileSummary.innerHTML = `
    <div class="profileAvatar" aria-hidden="true">LR</div>
    <div class="profileCopy"><strong>Lingua Relay account</strong><span>Private translation across your devices</span></div>
  `;
  profileScreen.append(profileSummary);

  const accountChip = byId("accountChip");
  if (accountChip) {
    accountChip.classList.add("screenCard", "profileAccount");
    profileScreen.append(accountChip);
  }

  const profileSettings = document.createElement("section");
  profileSettings.className = "screenCard settingsList";
  profileSettings.innerHTML = `
    <button type="button" class="settingsListRow" data-profile-target="languages"><span>Language preferences</span><span aria-hidden="true">›</span></button>
    <button type="button" class="settingsListRow" data-profile-target="privacy"><span>Privacy & safety</span><span aria-hidden="true">›</span></button>
    <button type="button" class="settingsListRow" data-profile-target="support"><span>Help & support</span><span aria-hidden="true">›</span></button>
  `;
  profileScreen.append(profileSettings);

  const legal = document.querySelector(".legal");
  if (legal) {
    legal.classList.add("screenCard", "profileLegal");
    profileScreen.append(legal);
  }

  const deleteButton = byId("deleteAccountBtn");
  if (deleteButton) {
    const danger = document.createElement("section");
    danger.className = "screenCard profileDanger";
    danger.append(deleteButton);
    profileScreen.append(danger);
  }

  screens.append(homeScreen, activityScreen, languagesScreen, profileScreen);
  page.insertBefore(screens, brand.nextSibling);

  const tabs = document.createElement("nav");
  tabs.id = "appTabs";
  tabs.className = "appTabs authed";
  tabs.setAttribute("aria-label", "Primary navigation");

  const tabSpec = [
    ["home", "Home", "M3 11.5 12 4l9 7.5v8a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5v-8Z"],
    ["activity", "Activity", "M4 4v16h16M7 15l3-3 3 2 5-6"],
    ["languages", "Languages", "M4 5h10M9 3v2c0 5-2 8-5 10M6 11c2 1 4 3 5 5M14 10h6l-3 9m-2-4h4"],
    ["profile", "Profile", "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-4 3-6 7-6s7 2 7 6"],
  ];

  const screenMap = {home: homeScreen, activity: activityScreen, languages: languagesScreen, profile: profileScreen};
  let currentTab = sessionStorage.getItem("lingua-relay.dashboard-tab") || "home";
  if (!screenMap[currentTab]) currentTab = "home";

  function selectTab(name, focus = false) {
    if (!screenMap[name]) return;
    currentTab = name;
    sessionStorage.setItem("lingua-relay.dashboard-tab", name);
    for (const [key, screen] of Object.entries(screenMap)) screen.hidden = key !== name;
    for (const button of tabs.querySelectorAll("button[data-tab]")) {
      const selected = button.dataset.tab === name;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    document.body.dataset.appScreen = name;
    window.scrollTo?.({top: 0, behavior: "instant"});
  }

  for (const [name, label, path] of tabSpec) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tab = name;
    button.setAttribute("role", "tab");
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg><span>${label}</span>`;
    button.addEventListener("click", () => selectTab(name));
    tabs.append(button);
  }

  tabs.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const names = tabSpec.map(([name]) => name);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    selectTab(names[(names.indexOf(currentTab) + delta + names.length) % names.length], true);
    event.preventDefault();
  });

  page.after(tabs);
  selectTab(currentTab);

  const setup = document.createElement("div");
  setup.id = "conversationSetup";
  setup.className = "conversationSetup";
  setup.hidden = true;
  setup.innerHTML = `
    <div class="setupScrim" data-setup-close></div>
    <section class="setupSheet" role="dialog" aria-modal="true" aria-labelledby="setupTitle">
      <div class="setupHandle" aria-hidden="true"></div>
      <header class="setupHeader">
        <button type="button" class="setupClose" data-setup-close aria-label="Close">×</button>
        <div class="setupModeIcon" id="setupModeIcon" aria-hidden="true"></div>
        <p class="screenEyebrow">New conversation</p>
        <h2 id="setupTitle">Video call</h2>
        <p id="setupDescription">Set up your side before the private room is created.</p>
      </header>
      <div class="setupFields">
        <label class="setupField"><span>I speak</span><select id="setupMyLanguage"></select></label>
        <div class="languageSwap" aria-hidden="true">⇄</div>
        <label class="setupField"><span>They speak</span><select id="setupTheirLanguage"></select></label>
      </div>
      <div class="setupPrivacy"><span aria-hidden="true">●</span><p>Private two-person room. The other person can choose a different language when they join.</p></div>
      <button id="setupStart" class="setupStart" type="button">Create private room</button>
    </section>
  `;
  document.body.append(setup);

  const setupTitle = byId("setupTitle");
  const setupDescription = byId("setupDescription");
  const setupModeIcon = byId("setupModeIcon");
  const setupMyLanguage = byId("setupMyLanguage");
  const setupTheirLanguage = byId("setupTheirLanguage");
  const setupStart = byId("setupStart");
  let setupSourceButton = null;
  let setupMode = "video";
  let bypassSetup = false;

  const setupModes = {
    video: {title: "Video call", description: "See each other while live captions and translation keep the conversation moving.", glyph: "▣"},
    voice: {title: "Voice call", description: "A private translated phone-style call with optional captions.", glyph: "◉"},
    chat: {title: "Text chat", description: "A private translated message thread for two people.", glyph: "✦"},
  };

  function populateSetupLanguages() {
    const source = byId("appLocaleSel");
    if (!source) return;
    const options = [...source.options];
    for (const target of [setupMyLanguage, setupTheirLanguage]) {
      const previous = target.value;
      target.replaceChildren(...options.map(option => option.cloneNode(true)));
      if (previous && [...target.options].some(option => option.value === previous)) target.value = previous;
    }
    const savedMine = localStorage.getItem("lingua-relay.setup.my-language");
    const savedTheirs = localStorage.getItem("lingua-relay.setup.their-language");
    setupMyLanguage.value = savedMine && [...setupMyLanguage.options].some(option => option.value === savedMine)
      ? savedMine : source.value;
    if (savedTheirs && [...setupTheirLanguage.options].some(option => option.value === savedTheirs)) {
      setupTheirLanguage.value = savedTheirs;
    } else {
      const alternative = [...setupTheirLanguage.options].find(option => option.value !== setupMyLanguage.value);
      if (alternative) setupTheirLanguage.value = alternative.value;
    }
  }

  function openSetup(mode, sourceButton) {
    setupMode = setupModes[mode] ? mode : "video";
    setupSourceButton = sourceButton;
    const config = setupModes[setupMode];
    setupTitle.textContent = config.title;
    setupDescription.textContent = config.description;
    setupModeIcon.textContent = config.glyph;
    setup.dataset.mode = setupMode;
    populateSetupLanguages();
    setup.hidden = false;
    document.body.classList.add("setupOpen");
    requestAnimationFrame(() => setup.classList.add("visible"));
    setTimeout(() => setupMyLanguage.focus(), 170);
  }

  function closeSetup() {
    setup.classList.remove("visible");
    document.body.classList.remove("setupOpen");
    setTimeout(() => { setup.hidden = true; }, 150);
    setupSourceButton?.focus?.();
  }

  for (const closer of setup.querySelectorAll("[data-setup-close]")) closer.addEventListener("click", closeSetup);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !setup.hidden) closeSetup();
  });

  setupStart.addEventListener("click", () => {
    if (!setupSourceButton) return;
    localStorage.setItem("lingua-relay.setup.my-language", setupMyLanguage.value);
    localStorage.setItem("lingua-relay.setup.their-language", setupTheirLanguage.value);
    localStorage.setItem("lingua-relay.setup.mode", setupMode);
    const source = setupSourceButton;
    closeSetup();
    homeHero.classList.add("compact");
    bypassSetup = true;
    source.click();
    bypassSetup = false;
  });

  profileSettings.querySelector('[data-profile-target="languages"]')?.addEventListener("click", () => selectTab("languages"));
  profileSettings.querySelector('[data-profile-target="support"]')?.addEventListener("click", () => {
    location.href = window.LinguaRuntime?.contentUrl?.("support") || "/support.html";
  });
  profileSettings.querySelector('[data-profile-target="privacy"]')?.addEventListener("click", () => {
    location.href = window.LinguaRuntime?.contentUrl?.("privacy") || "/privacy.html";
  });

  const createButtons = [
    [byId("createBtn"), "video"],
    [byId("createVoiceBtn"), "voice"],
    [byId("createChatBtn"), "chat"],
  ].filter(([button]) => Boolean(button));
  for (const [button, mode] of createButtons) {
    button.addEventListener("click", event => {
      if (bypassSetup) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openSetup(mode, button);
    }, {capture: true});
  }

  window.LinguaDashboardShell = Object.freeze({
    selectTab,
    current: () => currentTab,
    openConversationSetup: mode => openSetup(mode, createButtons.find(([, value]) => value === mode)?.[0]),
  });
})();

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
      <div><strong>Conversation languages</strong><p>You choose your spoken language when joining each private room.</p></div>
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
  const insertAfter = brand.nextSibling;
  page.insertBefore(screens, insertAfter);

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
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const names = tabSpec.map(([name]) => name);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    selectTab(names[(names.indexOf(currentTab) + delta + names.length) % names.length], true);
    event.preventDefault();
  });

  page.after(tabs);
  selectTab(currentTab);

  profileSettings.querySelector('[data-profile-target="languages"]')?.addEventListener("click", () => selectTab("languages"));
  profileSettings.querySelector('[data-profile-target="support"]')?.addEventListener("click", () => {
    location.href = window.LinguaRuntime?.contentUrl?.("support") || "/support.html";
  });
  profileSettings.querySelector('[data-profile-target="privacy"]')?.addEventListener("click", () => {
    location.href = window.LinguaRuntime?.contentUrl?.("privacy") || "/privacy.html";
  });

  const createButtons = [byId("createBtn"), byId("createVoiceBtn"), byId("createChatBtn")].filter(Boolean);
  for (const button of createButtons) {
    button.addEventListener("click", () => {
      homeHero.classList.add("compact");
    }, {capture: true});
  }

  window.LinguaDashboardShell = Object.freeze({selectTab, current: () => currentTab});
})();

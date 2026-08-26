(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const mode = document.body.dataset.mode || "video";
  const labels = {
    video: {title: "Video call", mark: "▣", gate: "Join translated video", detail: "Live video, captions, and spoken translation in one private room."},
    voice: {title: "Voice call", mark: "◉", gate: "Join translated call", detail: "A private phone-style conversation with live translation and optional captions."},
    chat: {title: "Translated chat", mark: "✦", gate: "Join translated chat", detail: "Messages appear with translation in a private two-person thread."},
  };
  const current = labels[mode] || labels.video;

  const header = document.createElement("header");
  header.id = "productRoomHeader";
  header.innerHTML = `
    <div class="productRoomIdentity">
      <div class="productRoomMark" aria-hidden="true">${current.mark}</div>
      <div class="productRoomCopy">
        <strong>${current.title}</strong>
        <span id="productRoomMeta" class="productRoomMeta">Private two-person room</span>
      </div>
    </div>
    <div id="productRoomLive" class="productRoomLive">Ready</div>
  `;

  const roleGate = byId("roleGate");
  if (roleGate) roleGate.after(header);
  else document.body.prepend(header);

  const alert = document.createElement("section");
  alert.id = "productRoomAlert";
  alert.className = "productRoomAlert";
  alert.hidden = true;
  alert.setAttribute("role", "status");
  alert.innerHTML = `
    <span id="productRoomAlertIcon" class="productRoomAlertIcon" aria-hidden="true">!</span>
    <div class="productRoomAlertCopy"><strong id="productRoomAlertTitle"></strong><p id="productRoomAlertText"></p></div>
    <button id="productRoomAlertAction" type="button" hidden></button>
    <button id="productRoomAlertDismiss" type="button" aria-label="Dismiss">×</button>
  `;
  document.body.append(alert);

  const endScreen = document.createElement("section");
  endScreen.id = "productEndScreen";
  endScreen.hidden = true;
  endScreen.setAttribute("aria-live", "polite");
  endScreen.innerHTML = `
    <div class="endConversationMark" aria-hidden="true">${current.mark}</div>
    <p class="endConversationEyebrow">${current.title}</p>
    <h1>Conversation ended</h1>
    <p id="endConversationReason" class="endConversationReason">This private room is no longer active.</p>
    <div class="endConversationSummary">
      <div><span>Language</span><strong id="endConversationLanguage">—</strong></div>
      <div><span>Duration</span><strong id="endConversationDuration">—</strong></div>
    </div>
    <p class="endConversationPrivacy">Conversation content is not shown on this screen. Your room link stops being useful when the room is closed or expired.</p>
    <button id="endConversationHome" type="button">Back to Home</button>
  `;
  document.body.append(endScreen);

  const roleCard = document.querySelector(".roleCard");
  if (roleCard) {
    const intro = document.createElement("div");
    intro.className = "productGateIntro";
    intro.innerHTML = `<span class="productGateMode">${current.mark} ${current.gate}</span><p>${current.detail}</p>`;
    const title = byId("roleTitle");
    if (title) title.before(intro);
  }

  if (mode === "voice") {
    const callShell = byId("callShell");
    if (callShell) {
      const visual = document.createElement("div");
      visual.className = "voiceProductVisual";
      visual.innerHTML = `
        <div class="voicePulse" aria-hidden="true"><div class="voiceAvatar">LR</div></div>
        <div id="voiceLanguagePair" class="voiceLanguagePair"><b>Live translation</b><span>Private call</span></div>
      `;
      callShell.prepend(visual);
    }
  }

  if (mode === "chat") {
    const captions = byId("captions");
    if (captions) {
      const chatHeader = document.createElement("header");
      chatHeader.className = "chatProductHeader";
      chatHeader.innerHTML = `
        <div class="chatAvatar" aria-hidden="true">LR</div>
        <div class="chatProductCopy"><strong>Translated conversation</strong><span id="chatProductStatus">Waiting for the other person</span></div>
        <span class="chatEncryption">Private room</span>
      `;
      captions.before(chatHeader);
    }
  }

  function selectedLanguage() {
    const select = byId("localeSel");
    if (!select) return "";
    const option = select.options?.[select.selectedIndex];
    return option?.textContent?.trim() || "";
  }

  function participantText() {
    const text = byId("participantCount")?.textContent?.trim() || "";
    const first = Number(text.match(/\d+/)?.[0] || 0);
    return first >= 2 ? "Connected" : first === 1 ? "Waiting" : "Ready";
  }

  function syncProductChrome() {
    const language = selectedLanguage();
    const state = participantText();
    const meta = byId("productRoomMeta");
    const live = byId("productRoomLive");
    if (meta) meta.textContent = language ? `${language} · Private room` : "Private two-person room";
    if (live && live.dataset.override !== "true") live.textContent = state;

    const voicePair = byId("voiceLanguagePair");
    if (voicePair) {
      const label = language || "Your language";
      voicePair.innerHTML = `<b>${label}</b><span>↔ live translation</span>`;
    }
    const chatStatus = byId("chatProductStatus");
    if (chatStatus) chatStatus.textContent = state === "Connected" ? "Live translation active" : "Waiting for the other person";
  }

  function terminalReason(text) {
    return /you left|call ended|declined|room (?:has )?expired|room.*closed|private room.*(?:expired|closed|unavailable)/i.test(text);
  }

  function recoveryFor(text) {
    if (/reconnecting|rejoining|background.*paused/i.test(text)) {
      return {icon: "↻", title: "Reconnecting", copy: "Keeping your private room ready while the connection comes back.", live: "Reconnecting"};
    }
    if (/microphone unavailable/i.test(text)) {
      return {icon: "◉", title: "Microphone unavailable", copy: "Check microphone permission, then try turning the microphone on again.", action: "Try microphone", target: "micBtn"};
    }
    if (/camera unavailable/i.test(text)) {
      return {icon: "▣", title: "Camera unavailable", copy: "You can keep talking without video or try the camera again.", action: "Try camera", target: "camBtn"};
    }
    if (/captions are busy/i.test(text)) {
      return {icon: "≋", title: "Translation is busy", copy: "The call can continue while captions recover. Try speaking again shortly."};
    }
    if (/room is full/i.test(text)) {
      return {icon: "2", title: "Room is full", copy: "This private room already has two people. Try again after someone leaves."};
    }
    return null;
  }

  function hideRecovery() {
    alert.hidden = true;
    const live = byId("productRoomLive");
    if (live) {
      live.dataset.override = "false";
      syncProductChrome();
    }
  }

  function showRecovery(config) {
    if (!config || !endScreen.hidden) return;
    byId("productRoomAlertIcon").textContent = config.icon;
    byId("productRoomAlertTitle").textContent = config.title;
    byId("productRoomAlertText").textContent = config.copy;
    const action = byId("productRoomAlertAction");
    action.hidden = !config.action;
    action.textContent = config.action || "";
    action.dataset.target = config.target || "";
    alert.hidden = false;
    const live = byId("productRoomLive");
    if (live && config.live) {
      live.dataset.override = "true";
      live.textContent = config.live;
    }
  }

  function showEndScreen(reason) {
    if (!reason || !terminalReason(reason)) return;
    hideRecovery();
    document.body.dataset.productRoomState = "ended";
    byId("endConversationReason").textContent = reason;
    byId("endConversationLanguage").textContent = selectedLanguage() || "Not selected";
    const timer = byId("callTimer")?.textContent?.trim();
    byId("endConversationDuration").textContent = timer && timer !== "0:00" ? timer : "—";
    endScreen.hidden = false;
    endScreen.querySelector("button")?.focus?.();
  }

  byId("productRoomAlertDismiss")?.addEventListener("click", hideRecovery);
  byId("productRoomAlertAction")?.addEventListener("click", () => {
    const target = byId(byId("productRoomAlertAction")?.dataset.target || "");
    hideRecovery();
    target?.click?.();
  });
  byId("endConversationHome")?.addEventListener("click", () => {
    try { sessionStorage.setItem("lingua-relay.dashboard-tab", "home"); } catch (_) {}
    location.href = window.LinguaRuntime?.isNative ? "index.html" : "/";
  });

  byId("localeSel")?.addEventListener("change", syncProductChrome);
  byId("roleLocaleSel")?.addEventListener("change", () => setTimeout(syncProductChrome, 0));
  const participant = byId("participantCount");
  if (participant && typeof MutationObserver === "function") {
    new MutationObserver(syncProductChrome).observe(participant, {childList: true, characterData: true, subtree: true});
  }
  for (const stateNode of [byId("status"), byId("callState")].filter(Boolean)) {
    if (typeof MutationObserver !== "function") continue;
    new MutationObserver(() => {
      const text = stateNode.textContent?.trim() || "";
      if (terminalReason(text)) showEndScreen(text);
      else {
        if (text) document.body.dataset.productRoomState = "live";
        const recovery = recoveryFor(text);
        if (recovery) showRecovery(recovery);
        else if (!/unavailable|busy|reconnect|rejoin|paused|full/i.test(text)) hideRecovery();
      }
    }).observe(stateNode, {childList: true, characterData: true, subtree: true});
  }

  const preferred = (() => {
    try { return localStorage.getItem("lingua-relay.setup.my-language") || ""; }
    catch { return ""; }
  })();
  if (preferred) {
    const roleSelect = byId("roleLocaleSel");
    const applyPreferred = () => {
      if (!roleSelect || ![...roleSelect.options].some(option => option.value === preferred)) return false;
      if (!roleSelect.value) {
        roleSelect.value = preferred;
        roleSelect.dispatchEvent(new Event("change", {bubbles: true}));
      }
      return true;
    };
    if (!applyPreferred() && roleSelect && typeof MutationObserver === "function") {
      const observer = new MutationObserver(() => { if (applyPreferred()) observer.disconnect(); });
      observer.observe(roleSelect, {childList: true});
    }
  }

  syncProductChrome();
})();

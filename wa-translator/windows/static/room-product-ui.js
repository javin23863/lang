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
    if (live) live.textContent = state;

    const voicePair = byId("voiceLanguagePair");
    if (voicePair) {
      const label = language || "Your language";
      voicePair.innerHTML = `<b>${label}</b><span>↔ live translation</span>`;
    }
    const chatStatus = byId("chatProductStatus");
    if (chatStatus) chatStatus.textContent = state === "Connected" ? "Live translation active" : "Waiting for the other person";
  }

  function showEndScreen(reason) {
    if (!reason || !/left|closed|expired|ended|declined|unavailable/i.test(reason)) return;
    document.body.dataset.productRoomState = "ended";
    byId("endConversationReason").textContent = reason;
    byId("endConversationLanguage").textContent = selectedLanguage() || "Not selected";
    const timer = byId("callTimer")?.textContent?.trim();
    byId("endConversationDuration").textContent = timer && timer !== "0:00" ? timer : "—";
    endScreen.hidden = false;
    endScreen.querySelector("button")?.focus?.();
  }

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
      if (/left|closed|expired|ended|declined|unavailable/i.test(text)) showEndScreen(text);
      else if (text) document.body.dataset.productRoomState = "live";
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

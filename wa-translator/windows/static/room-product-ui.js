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

  byId("localeSel")?.addEventListener("change", syncProductChrome);
  byId("roleLocaleSel")?.addEventListener("change", () => setTimeout(syncProductChrome, 0));
  const participant = byId("participantCount");
  if (participant && typeof MutationObserver === "function") {
    new MutationObserver(syncProductChrome).observe(participant, {childList: true, characterData: true, subtree: true});
  }
  const status = byId("status");
  if (status && typeof MutationObserver === "function") {
    new MutationObserver(() => {
      const text = status.textContent?.trim() || "";
      document.body.dataset.productRoomState = /left|closed|expired|ended/i.test(text) ? "ended" : "live";
    }).observe(status, {childList: true, characterData: true, subtree: true});
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

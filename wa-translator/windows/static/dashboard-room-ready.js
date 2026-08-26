(() => {
  "use strict";
  const panel = document.getElementById("roomPanel");
  const state = document.getElementById("roomState");
  const open = document.getElementById("openBtn");
  const share = document.getElementById("shareBtn");
  if (!panel || !state || !open || !share || document.getElementById("roomPrimaryActions")) return;

  const experience = panel.querySelector(".roomExperience");
  const status = document.createElement("span");
  status.id = "roomReadyStatus";
  status.className = "roomReadyStatus";
  status.textContent = "Ready";
  experience?.append(status);

  const primary = document.createElement("div");
  primary.id = "roomPrimaryActions";
  primary.className = "roomPrimaryActions";
  open.classList.add("roomEnterAction");
  share.classList.add("roomInviteAction");
  primary.append(open, share);

  const field = panel.querySelector(".field");
  if (field) field.before(primary);
  else panel.append(primary);

  const originalActions = panel.querySelector(".actions:not(.share)");
  if (originalActions) originalActions.classList.add("roomUtilityActions");

  function mode() {
    try { return localStorage.getItem("lingua-relay.setup.mode") || "video"; }
    catch { return "video"; }
  }

  function render() {
    const currentMode = mode();
    open.textContent = currentMode === "voice" ? "Enter voice call" : currentMode === "chat" ? "Open chat" : "Enter video call";
    share.textContent = "Invite person";

    const text = state.textContent || "";
    const stateKey = state.dataset.state || "idle";
    let label = "Ready";
    let tone = "ready";
    if (stateKey === "open" && /2 participant|2 people/i.test(text)) {
      label = "Connected";
      tone = "connected";
    } else if (stateKey === "open") {
      label = "Waiting";
      tone = "waiting";
    } else if (stateKey === "error") {
      label = "Needs attention";
      tone = "error";
    } else if (stateKey === "closed" || stateKey === "expired") {
      label = stateKey === "closed" ? "Closed" : "Expired";
      tone = "ended";
    }
    status.textContent = label;
    status.dataset.tone = tone;
    panel.dataset.roomReadyState = tone;
  }

  if (typeof MutationObserver === "function") {
    new MutationObserver(render).observe(state, {attributes: true, childList: true, subtree: true, attributeFilter: ["data-state"]});
  }
  render();

  const byId = id => document.getElementById(id);
  const invite = document.createElement("div");
  invite.id = "roomInviteSheet";
  invite.className = "roomInviteSheet";
  invite.hidden = true;
  invite.innerHTML = `
    <div class="roomInviteScrim" data-invite-close></div>
    <section class="roomInvitePanel" role="dialog" aria-modal="true" aria-labelledby="roomInviteTitle" aria-describedby="roomInviteDescription">
      <div class="roomInviteHandle" aria-hidden="true"></div>
      <header class="roomInviteHeader">
        <button type="button" class="roomInviteClose" data-invite-close aria-label="Close invitation">×</button>
        <div id="roomInviteStatus" class="roomInviteStatus" data-tone="waiting" role="status" aria-live="polite"><span aria-hidden="true"></span><strong>Waiting</strong></div>
        <p class="screenEyebrow">Private room</p>
        <h2 id="roomInviteTitle">Invite person</h2>
        <p id="roomInviteDescription">Share this private invitation with the one person you want to talk with.</p>
      </header>
      <div class="roomInviteSummary" aria-label="Invitation details">
        <div><span>Mode</span><strong id="roomInviteMode">Video call</strong></div>
        <div><span>Languages</span><strong id="roomInviteLanguages">—</strong></div>
      </div>
      <figure class="roomInviteQr">
        <div id="roomInviteQrBox" class="roomInviteQrBox" aria-label="Room invitation QR code"></div>
        <figcaption>Scan to join this room</figcaption>
      </figure>
      <button id="roomInviteShare" class="roomInviteShare" type="button">Share invitation</button>
      <div class="roomInviteActions">
        <button id="roomInviteCopy" type="button"><span aria-hidden="true">⧉</span><strong>Copy link</strong></button>
        <button id="roomInviteWhatsApp" type="button"><span aria-hidden="true">W</span><strong>WhatsApp</strong></button>
        <button id="roomInviteLine" type="button"><span aria-hidden="true">L</span><strong>LINE</strong></button>
      </div>
      <p id="roomInviteNativeChannels" class="roomInviteNativeChannels" hidden>WhatsApp and LINE are available from your device Share sheet.</p>
      <p id="roomInviteWaiting" class="roomInviteWaiting" aria-live="polite">Waiting for the other person to join.</p>
    </section>
  `;
  document.body.append(invite);

  const invitePanel = invite.querySelector(".roomInvitePanel");
  const inviteStatus = byId("roomInviteStatus");
  const inviteStatusLabel = inviteStatus?.querySelector("strong");
  const inviteMode = byId("roomInviteMode");
  const inviteLanguages = byId("roomInviteLanguages");
  const inviteQrBox = byId("roomInviteQrBox");
  const inviteShare = byId("roomInviteShare");
  const inviteCopy = byId("roomInviteCopy");
  const inviteWhatsApp = byId("roomInviteWhatsApp");
  const inviteLine = byId("roomInviteLine");
  const inviteNativeChannels = byId("roomInviteNativeChannels");
  const inviteWaiting = byId("roomInviteWaiting");
  const shareLink = byId("shareLink");
  const sourceCopy = byId("copyBtn");
  const sourceWhatsApp = byId("waBtn");
  const sourceLine = byId("lineBtn");
  let renderedQr = "";
  let sourceFocus = null;
  let hideTimer = null;
  let systemShare = null;
  let copyLink = null;
  let shareWhatsApp = null;
  let shareLine = null;

  function storageValue(key) {
    try { return localStorage.getItem(key) || ""; }
    catch { return ""; }
  }

  function languageLabel(value, selectId) {
    const select = byId(selectId);
    const selected = select?.selectedOptions?.[0]?.textContent?.trim();
    if (selected && (!value || select.value === value)) return selected;
    const appLocale = byId("appLocaleSel");
    const option = [...(appLocale?.options || [])].find(candidate => candidate.value === value);
    return option?.textContent?.trim() || value || "—";
  }

  function modeLabel() {
    const current = mode();
    return current === "voice" ? "Voice call" : current === "chat" ? "Text chat" : "Video call";
  }

  function languagePair() {
    const mine = storageValue("lingua-relay.setup.my-language");
    const theirs = storageValue("lingua-relay.setup.their-language");
    return `${languageLabel(mine, "setupMyLanguage")} ↔ ${languageLabel(theirs, "setupTheirLanguage")}`;
  }

  function statusCopy() {
    const tone = status.dataset.tone || "ready";
    if (tone === "connected") return {tone, label: "Connected", copy: "The other person joined. Open the room when you are ready."};
    if (tone === "error") return {tone, label: "Needs attention", copy: "Room status is temporarily unavailable. Your invitation is still shown here."};
    if (tone === "ended") return {tone, label: "Room ended", copy: "This invitation is no longer active."};
    return {tone: "waiting", label: "Waiting", copy: "Waiting for the other person to join."};
  }

  function syncInviteActions() {
    const native = Boolean(window.LinguaRuntime?.isNative);
    inviteShare.disabled = share.disabled;
    inviteCopy.disabled = Boolean(sourceCopy?.disabled);
    inviteWhatsApp.hidden = native;
    inviteLine.hidden = native;
    inviteNativeChannels.hidden = !native;
    if (!native) {
      inviteWhatsApp.disabled = Boolean(sourceWhatsApp?.disabled);
      inviteLine.disabled = Boolean(sourceLine?.disabled);
    }
  }

  function renderInvite() {
    if (invite.hidden) return;
    const link = shareLink?.value?.trim() || "";
    if (panel.hidden || !link) {
      closeInvite(false);
      return;
    }
    inviteMode.textContent = modeLabel();
    inviteLanguages.textContent = languagePair();
    const currentStatus = statusCopy();
    inviteStatus.dataset.tone = currentStatus.tone;
    inviteStatusLabel.textContent = currentStatus.label;
    inviteWaiting.textContent = currentStatus.copy;
    syncInviteActions();
    if (link !== renderedQr && window.LinguaQR?.svg) {
      inviteQrBox.replaceChildren(window.LinguaQR.svg(link));
      renderedQr = link;
    }
  }

  function openInvite(source = share) {
    const link = shareLink?.value?.trim() || "";
    if (panel.hidden || share.disabled || !link) return false;
    clearTimeout(hideTimer);
    hideTimer = null;
    sourceFocus = source;
    invite.hidden = false;
    document.body.classList.add("inviteOpen");
    renderInvite();
    requestAnimationFrame(() => invite.classList.add("visible"));
    requestAnimationFrame(() => invite.querySelector(".roomInviteClose")?.focus());
    return true;
  }

  function closeInvite(restoreFocus = true) {
    if (invite.hidden) return;
    invite.classList.remove("visible");
    document.body.classList.remove("inviteOpen");
    renderedQr = "";
    inviteQrBox.replaceChildren();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      invite.hidden = true;
      hideTimer = null;
    }, 180);
    if (restoreFocus) sourceFocus?.focus?.();
  }

  function visibleInviteControls() {
    return [...invitePanel.querySelectorAll("button")].filter(button => !button.hidden && !button.disabled && button.offsetParent !== null);
  }

  for (const closer of invite.querySelectorAll("[data-invite-close]")) {
    closer.addEventListener("click", () => closeInvite());
  }

  document.addEventListener("keydown", event => {
    if (invite.hidden) return;
    if (event.key === "Escape") {
      closeInvite();
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = visibleInviteControls();
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  });

  if (typeof MutationObserver === "function") {
    const inviteObserver = new MutationObserver(() => {
      if (!invite.hidden) renderInvite();
    });
    inviteObserver.observe(status, {attributes: true, childList: true, subtree: true, attributeFilter: ["data-tone"]});
    inviteObserver.observe(panel, {attributes: true, attributeFilter: ["hidden"]});
    for (const control of [share, sourceCopy, sourceWhatsApp, sourceLine].filter(Boolean)) {
      inviteObserver.observe(control, {attributes: true, attributeFilter: ["disabled", "hidden"]});
    }
  }

  function installInviteActions() {
    if (share.dataset.inviteSheetInstalled === "true") return;
    systemShare = typeof share.onclick === "function" ? share.onclick : null;
    copyLink = typeof sourceCopy?.onclick === "function" ? sourceCopy.onclick : null;
    shareWhatsApp = typeof sourceWhatsApp?.onclick === "function" ? sourceWhatsApp.onclick : null;
    shareLine = typeof sourceLine?.onclick === "function" ? sourceLine.onclick : null;
    share.onclick = event => {
      event?.preventDefault?.();
      openInvite(share);
    };
    share.dataset.inviteSheetInstalled = "true";

    inviteShare.addEventListener("click", async event => {
      if (share.disabled || !systemShare) return;
      await systemShare.call(share, event);
      renderInvite();
    });
    inviteCopy.addEventListener("click", async event => {
      if (sourceCopy?.disabled || !copyLink) return;
      const copied = await copyLink.call(sourceCopy, event);
      if (copied) {
        const original = inviteWaiting.textContent;
        inviteWaiting.textContent = "Invitation link copied.";
        setTimeout(() => {
          if (!invite.hidden && inviteWaiting.textContent === "Invitation link copied.") {
            inviteWaiting.textContent = statusCopy().copy || original;
          }
        }, 1500);
      }
    });
    inviteWhatsApp.addEventListener("click", event => {
      if (sourceWhatsApp?.disabled || !shareWhatsApp) return;
      shareWhatsApp.call(sourceWhatsApp, event);
    });
    inviteLine.addEventListener("click", event => {
      if (sourceLine?.disabled || !shareLine) return;
      shareLine.call(sourceLine, event);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installInviteActions, {once: true});
  } else {
    installInviteActions();
  }
})();

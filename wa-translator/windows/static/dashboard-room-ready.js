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
})();

(() => {
  "use strict";
  const home = document.getElementById("screenHome");
  const state = document.getElementById("roomState");
  if (!home || !state || document.getElementById("homeStateCard")) return;

  const card = document.createElement("section");
  card.id = "homeStateCard";
  card.className = "screenCard homeStateCard";
  card.hidden = true;
  card.innerHTML = `
    <div id="homeStateIcon" class="homeStateIcon" aria-hidden="true">!</div>
    <div class="homeStateCopy"><p class="screenEyebrow">Room status</p><h3 id="homeStateTitle"></h3><p id="homeStateDescription"></p></div>
    <button id="homeStateAction" type="button">Start new conversation</button>
  `;
  const roomPanel = document.getElementById("roomPanel");
  if (roomPanel) roomPanel.after(card);
  else home.append(card);

  const offline = document.createElement("div");
  offline.id = "offlineBanner";
  offline.className = "offlineBanner";
  offline.hidden = true;
  offline.setAttribute("role", "status");
  offline.innerHTML = `<span aria-hidden="true">⌁</span><div><strong>You're offline</strong><p>Reconnect to create, join, or refresh a private room.</p></div>`;
  home.prepend(offline);

  const copy = {
    closed: ["✓", "Room closed", "That invitation no longer works. Start another conversation when you're ready."],
    expired: ["◷", "Room expired", "Private rooms are temporary. Create a new room to continue talking."],
    error: ["!", "Room unavailable", "The app could not refresh this room. Your account and conversation preferences are still here."],
  };

  function renderState() {
    const key = state.dataset.state || "idle";
    const value = copy[key];
    if (!value) {
      card.hidden = true;
      return;
    }
    document.getElementById("homeStateIcon").textContent = value[0];
    document.getElementById("homeStateTitle").textContent = value[1];
    document.getElementById("homeStateDescription").textContent = value[2];
    card.dataset.state = key;
    card.hidden = false;
  }

  function renderNetwork() {
    offline.hidden = navigator.onLine !== false;
    document.body.classList.toggle("appOffline", navigator.onLine === false);
  }

  document.getElementById("homeStateAction")?.addEventListener("click", () => {
    let mode = "video";
    try { mode = localStorage.getItem("lingua-relay.setup.mode") || mode; } catch (_) {}
    window.LinguaDashboardShell?.openConversationSetup?.(mode);
  });

  if (typeof MutationObserver === "function") {
    new MutationObserver(renderState).observe(state, {attributes: true, childList: true, subtree: true, attributeFilter: ["data-state"]});
  }
  window.addEventListener("online", renderNetwork);
  window.addEventListener("offline", renderNetwork);
  renderState();
  renderNetwork();
})();

(() => {
  "use strict";

  const screen = document.getElementById("productEndScreen");
  const home = document.getElementById("endConversationHome");
  if (!screen || !home || document.getElementById("endConversationAgain")) return;

  const mode = document.body.dataset.mode === "voice" ? "voice"
    : document.body.dataset.mode === "chat" ? "chat" : "video";
  const label = mode === "voice" ? "voice call" : mode === "chat" ? "translated chat" : "video call";

  const actions = document.createElement("div");
  actions.className = "endConversationActions";
  const again = document.createElement("button");
  again.id = "endConversationAgain";
  again.type = "button";
  again.textContent = `Start another ${label}`;
  home.replaceWith(actions);
  actions.append(again, home);

  again.addEventListener("click", () => {
    try {
      sessionStorage.setItem("lingua-relay.dashboard-tab", "home");
      sessionStorage.setItem("lingua-relay.pending-conversation-mode", mode);
    } catch (_) {}
    location.href = window.LinguaRuntime?.isNative ? "index.html" : "/";
  });
})();

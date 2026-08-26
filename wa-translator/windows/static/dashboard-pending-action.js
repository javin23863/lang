(() => {
  "use strict";

  const KEY = "lingua-relay.pending-conversation-mode";
  let mode = "";
  try {
    mode = sessionStorage.getItem(KEY) || "";
    if (mode) sessionStorage.removeItem(KEY);
  } catch (_) {}
  if (!["video", "voice", "chat"].includes(mode)) return;

  let opened = false;
  function openWhenReady() {
    if (opened || document.body.dataset.auth !== "in" || !window.LinguaDashboardShell) return;
    opened = true;
    window.LinguaDashboardShell.selectTab("home");
    setTimeout(() => window.LinguaDashboardShell?.openConversationSetup?.(mode), 60);
  }

  if (typeof MutationObserver === "function") {
    const observer = new MutationObserver(() => {
      openWhenReady();
      if (opened) observer.disconnect();
    });
    observer.observe(document.body, {attributes: true, attributeFilter: ["data-auth"]});
  }
  window.addEventListener("load", openWhenReady, {once: true});
  openWhenReady();
})();

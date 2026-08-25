(() => {
  "use strict";

  const STORAGE_KEY = "lingua-relay.onboarding.v1";
  const panel = document.getElementById("onboardingPanel");
  if (!panel) return;

  const completionTargets = new Set([
    "signInGoogle", "signInApple", "signInFacebook",
    "createVoiceBtn", "createChatBtn", "createBtn",
  ]);

  function isComplete() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function emit(name) {
    window.LinguaProductEvents?.emit(name);
  }

  function reveal() {
    if (isComplete()) return;
    panel.hidden = false;
    emit("onboarding.view");
  }

  function complete() {
    if (panel.hidden && isComplete()) return;
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch (_) {
      // Storage can be unavailable in restricted browser modes. The current
      // interaction still proceeds; the explainer may simply reappear later.
    }
    panel.hidden = true;
    emit("onboarding.complete");
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest("button,a") : null;
    if (target && completionTargets.has(target.id)) complete();
  });

  reveal();
})();

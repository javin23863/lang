(() => {
  "use strict";

  const MODES = new Set(["voice", "chat", "video"]);
  const requestedMode = new URLSearchParams(location.search).get("m");
  const mode = MODES.has(requestedMode) ? requestedMode : "video";
  let pairReadyEmitted = false;
  let firstTranslationEmitted = false;

  function emit(name, properties = {}) {
    return window.LinguaProductEvents?.emit(name, properties) === true;
  }

  function observePairReady() {
    const count = document.getElementById("participantCount");
    if (!count) return;
    const check = () => {
      if (pairReadyEmitted || !/^\s*2\s*\/\s*2(?:\D|$)/.test(count.textContent || "")) return;
      pairReadyEmitted = emit("room.pair.ready", {mode});
    };
    new MutationObserver(check).observe(count, {childList: true, characterData: true, subtree: true});
    check();
  }

  function observeFirstTranslation() {
    const captions = document.getElementById("captions");
    if (!captions) return;
    const check = () => {
      if (firstTranslationEmitted) return;
      for (const sub of captions.querySelectorAll(".msg .sub")) {
        if ((sub.textContent || "").trim()) {
          firstTranslationEmitted = emit("translation.first.result", {mode});
          return;
        }
      }
    };
    new MutationObserver(check).observe(captions, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    check();
  }

  function install() {
    document.getElementById("joinBtn")?.addEventListener("click", () => {
      emit("room.join.intent", {mode});
    });
    observePairReady();
    observeFirstTranslation();
  }

  window.addEventListener("offline", () => emit("network.state", {state: "offline"}));
  window.addEventListener("online", () => emit("network.state", {state: "online"}));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, {once: true});
  } else {
    install();
  }
})();

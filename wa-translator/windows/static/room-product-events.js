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

  function roomIsActive() {
    const gate = document.getElementById("roleGate");
    return Boolean(gate?.hidden);
  }

  function presentNetworkState(state) {
    document.body.dataset.network = state;
    emit("network.state", {state});
    if (!roomIsActive()) return;
    const status = document.getElementById("status");
    const t = window.LinguaRuntime?.t;
    if (!status || typeof t !== "function") return;
    const key = state === "offline" ? "status.reconnecting" : "status.rejoining";
    status.textContent = t(key);
    status.hidden = false;
  }

  function install() {
    document.getElementById("joinBtn")?.addEventListener("click", () => {
      emit("room.join.intent", {mode});
    });
    observePairReady();
    observeFirstTranslation();
    document.body.dataset.network = navigator.onLine === false ? "offline" : "online";
  }

  window.addEventListener("offline", () => presentNetworkState("offline"));
  window.addEventListener("online", () => presentNetworkState("online"));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, {once: true});
  } else {
    install();
  }
})();

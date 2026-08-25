(() => {
  "use strict";

  const events = window.LinguaProductEvents;
  if (!events) return;

  const CREATE_MODE = Object.freeze({
    createVoiceBtn: "voice",
    createChatBtn: "chat",
    createBtn: "video",
  });
  const SHARE_METHOD = Object.freeze({
    copyBtn: "copy",
    shareBtn: "system",
    waBtn: "whatsapp",
    lineBtn: "line",
    qrBtn: "qr",
  });

  function actionableTarget(event) {
    return event.target instanceof Element ? event.target.closest("button,a") : null;
  }

  function captureAuthState() {
    const state = document.body.dataset.auth;
    if (state !== "in" && state !== "out") return;
    const providerCount = state === "out"
      ? document.querySelectorAll("#authButtons .signIn").length
      : 0;
    const signature = `${state}:${providerCount}`;
    if (captureAuthState.last === signature) return;
    captureAuthState.last = signature;
    events.emit("auth.state", {state, provider_count: providerCount});
  }
  captureAuthState.last = "";

  document.addEventListener("click", event => {
    const target = actionableTarget(event);
    const id = target?.id || "";
    const mode = CREATE_MODE[id];
    if (mode) {
      events.emit("room.create.intent", {mode});
      return;
    }
    const method = SHARE_METHOD[id];
    if (method) {
      events.emit("invite.share.intent", {method});
      return;
    }
    if (id === "openBtn") events.emit("room.open.intent");
  });

  document.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.id !== "appLocaleSel") return;
    events.emit("locale.change", {locale: target.value});
  });

  new MutationObserver(captureAuthState).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-auth"],
  });
  captureAuthState();
})();

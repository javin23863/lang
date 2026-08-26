(() => {
  "use strict";

  const SHARE_TEXT = Object.freeze({
    voice: "share.textVoice",
    chat: "share.textChat",
    video: "share.textVideo",
  });

  function create({runtime, t, byId, getRoom, isBusy, roomMode, roomUrl, setNotice, hideQr}) {
    for (const dependency of [t, byId, getRoom, isBusy, roomMode, roomUrl, setNotice, hideQr]) {
      if (typeof dependency !== "function") throw new TypeError("dashboard share dependencies are required");
    }
    if (!runtime || typeof runtime.share !== "function") {
      throw new TypeError("dashboard share runtime is required");
    }

    function availableRoom() {
      return isBusy() ? null : getRoom();
    }

    async function copy() {
      const room = availableRoom();
      if (!room) return false;
      const link = roomUrl(room);
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(link);
        else {
          byId("shareLink").focus();
          byId("shareLink").select();
          if (!document.execCommand("copy")) throw new Error("copy failed");
        }
        setNotice("home.linkCopied");
        return true;
      } catch (_) {
        byId("shareLink").focus();
        byId("shareLink").select();
        setNotice("home.selectToCopy");
        return false;
      }
    }

    function message(room) {
      return t(SHARE_TEXT[roomMode(room)]) + " " + roomUrl(room);
    }

    function openApp(url) {
      const opened = window.open(url, "_blank", "noopener");
      if (opened) opened.opener = null;
      else setNotice("home.openBlocked");
    }

    async function systemShare() {
      const room = availableRoom();
      if (!room) return false;
      const link = roomUrl(room);
      if (await runtime.share({
        title: t("share.title"),
        text: t(SHARE_TEXT[roomMode(room)]),
        url: link,
      })) {
        setNotice("home.linkShared");
        return true;
      }
      return copy();
    }

    function whatsapp() {
      const room = availableRoom();
      if (room) openApp("https://wa.me/?text=" + encodeURIComponent(message(room)));
    }

    function line() {
      const room = availableRoom();
      if (room) openApp("https://line.me/R/share?text=" + encodeURIComponent(message(room)));
    }

    function toggleQr() {
      const room = availableRoom();
      if (!room) return;
      const box = byId("qrBox");
      if (!box.hidden) {
        hideQr();
        return;
      }
      box.replaceChildren(window.LinguaQR.svg(roomUrl(room)));
      box.hidden = false;
      byId("qrBtn").setAttribute("aria-expanded", "true");
    }

    function applyPlatformVisibility() {
      if (!runtime.isNative) return;
      // Native uses the system share sheet for installed apps. QR remains the
      // link-transfer path for clients without a URL-scheme integration.
      byId("waBtn").hidden = true;
      byId("lineBtn").hidden = true;
    }

    return Object.freeze({copy, systemShare, whatsapp, line, toggleQr, applyPlatformVisibility});
  }

  Object.defineProperty(window, "LinguaDashboardShare", {
    value: Object.freeze({create}),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();

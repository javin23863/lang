(() => {
  "use strict";

  if (document.body.dataset.mode !== "voice") return;
  const roleGate = document.getElementById("roleGate");
  const participant = document.getElementById("participantCount");
  const captions = document.getElementById("captionsToggle");
  const voice = document.getElementById("voiceBtn");
  if (!participant) return;

  const read = key => {
    try { return localStorage.getItem(key) === "1"; }
    catch (_) { return false; }
  };
  let applied = false;

  function connected() {
    const count = Number(participant.textContent?.match(/\d+/)?.[0] || 0);
    return count >= 2;
  }

  function applyDefaults() {
    if (applied || (roleGate && !roleGate.hidden) || !connected()) return;
    applied = true;

    if (read("lingua-relay.pref.voice-captions")
        && document.body.dataset.captions !== "on" && !captions?.disabled) {
      captions?.click?.();
    }
    if (read("lingua-relay.pref.translated-voice")
        && voice && !voice.disabled && voice.classList.contains("off")) {
      voice.click();
    }
  }

  if (typeof MutationObserver === "function") {
    new MutationObserver(applyDefaults).observe(participant, {childList: true, characterData: true, subtree: true});
    if (roleGate) new MutationObserver(applyDefaults).observe(roleGate, {attributes: true, attributeFilter: ["hidden"]});
    if (voice) new MutationObserver(applyDefaults).observe(voice, {attributes: true, attributeFilter: ["disabled", "class"]});
  }
  applyDefaults();
})();

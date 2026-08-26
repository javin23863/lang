(() => {
  "use strict";

  const profile = document.getElementById("screenProfile");
  if (!profile) return;

  const MODE_KEY = "lingua-relay.pref.default-mode";
  const CAPTIONS_KEY = "lingua-relay.pref.voice-captions";
  const VOICE_KEY = "lingua-relay.pref.translated-voice";
  const modes = [
    ["video", "▣", "Video"],
    ["voice", "◉", "Voice"],
    ["chat", "✦", "Chat"],
  ];

  const card = document.createElement("section");
  card.className = "screenCard callPreferencesCard";
  card.innerHTML = `
    <div class="sectionLabelRow"><strong>Conversation defaults</strong><span>On this device</span></div>
    <div class="preferenceBlock">
      <div class="preferenceCopy"><strong>Start with</strong><span>Highlight the conversation type you use most.</span></div>
      <div id="defaultModePicker" class="defaultModePicker" role="radiogroup" aria-label="Default conversation type"></div>
    </div>
    <label class="preferenceToggle">
      <span class="preferenceCopy"><strong>Voice captions by default</strong><span>Show live captions automatically after a voice call connects.</span></span>
      <input id="voiceCaptionsDefault" type="checkbox"><span class="switchTrack" aria-hidden="true"><span></span></span>
    </label>
    <label class="preferenceToggle">
      <span class="preferenceCopy"><strong>Translated voice by default</strong><span>Turn on translated speech automatically after a voice call connects.</span></span>
      <input id="translatedVoiceDefault" type="checkbox"><span class="switchTrack" aria-hidden="true"><span></span></span>
    </label>
  `;

  const settings = profile.querySelector(".settingsList");
  profile.insertBefore(card, settings || null);

  const picker = document.getElementById("defaultModePicker");
  const captions = document.getElementById("voiceCaptionsDefault");
  const translatedVoice = document.getElementById("translatedVoiceDefault");

  function read(key, fallback = "") {
    try { return localStorage.getItem(key) ?? fallback; }
    catch (_) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  let defaultMode = read(MODE_KEY, "video");
  if (!modes.some(([value]) => value === defaultMode)) defaultMode = "video";

  function paintHomeDefault() {
    const map = {
      video: document.getElementById("createBtn"),
      voice: document.getElementById("createVoiceBtn"),
      chat: document.getElementById("createChatBtn"),
    };
    for (const [mode, button] of Object.entries(map)) {
      if (!button) continue;
      const selected = mode === defaultMode;
      button.classList.toggle("preferredMode", selected);
      let badge = button.querySelector(".preferredModeBadge");
      if (selected && !badge) {
        badge = document.createElement("span");
        badge.className = "preferredModeBadge";
        badge.textContent = "Default";
        button.append(badge);
      }
      if (!selected) badge?.remove();
    }
  }

  function renderModes() {
    picker.replaceChildren();
    for (const [value, glyph, label] of modes) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mode = value;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(value === defaultMode));
      button.classList.toggle("selected", value === defaultMode);
      button.innerHTML = `<span aria-hidden="true">${glyph}</span><strong>${label}</strong>`;
      button.addEventListener("click", () => {
        defaultMode = value;
        write(MODE_KEY, value);
        renderModes();
        paintHomeDefault();
        window.dispatchEvent(new CustomEvent("lingua-preferences-change", {detail: {defaultMode: value}}));
      });
      picker.append(button);
    }
  }

  captions.checked = read(CAPTIONS_KEY, "0") === "1";
  translatedVoice.checked = read(VOICE_KEY, "0") === "1";
  captions.addEventListener("change", () => write(CAPTIONS_KEY, captions.checked ? "1" : "0"));
  translatedVoice.addEventListener("change", () => write(VOICE_KEY, translatedVoice.checked ? "1" : "0"));

  renderModes();
  paintHomeDefault();
})();

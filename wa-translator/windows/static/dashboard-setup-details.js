(() => {
  "use strict";
  const setup = document.getElementById("conversationSetup");
  const fields = setup?.querySelector(".setupFields");
  if (!setup || !fields || document.getElementById("setupModeDetails")) return;

  const details = document.createElement("section");
  details.id = "setupModeDetails";
  details.className = "setupModeDetails";
  fields.after(details);

  const modes = {
    video: {
      title: "Before your video call",
      intro: "Video can work with camera, microphone, captions, and translated voice. You stay in control of each feature.",
      rows: [
        ["mic", "Microphone", "Requested when you turn your microphone on."],
        ["camera", "Camera", "Requested when you turn your camera on. You can continue without video."],
        ["captions", "Live translation", "Captions and translated voice are available inside the room."],
      ],
    },
    voice: {
      title: "Before your voice call",
      intro: "Voice calls use your microphone and can show translated captions while you talk.",
      rows: [
        ["mic", "Microphone", "Requested when you start or answer the call."],
        ["captions", "Captions", "Turn captions on during the call whenever you want them."],
        ["speaker", "Translated voice", "Optional spoken translation can play through your device."],
      ],
    },
    chat: {
      title: "Before your chat",
      intro: "Translated chat works without camera or microphone access.",
      rows: [
        ["chat", "No media permission", "Type messages without enabling your camera or microphone."],
        ["translate", "Translated messages", "The conversation thread shows translated text for both people."],
        ["private", "Private room", "Only the two people with this room can participate."],
      ],
    },
  };

  const glyphs = {
    mic: "◉", camera: "▣", captions: "≋", speaker: ")))",
    chat: "✦", translate: "A↔", private: "2",
  };

  function render() {
    const config = modes[setup.dataset.mode] || modes.video;
    details.innerHTML = `
      <div class="setupDetailsHeading"><strong>${config.title}</strong><p>${config.intro}</p></div>
      <div class="setupDetailsRows">
        ${config.rows.map(([icon, title, copy]) => `
          <div class="setupDetailRow">
            <span class="setupDetailGlyph" aria-hidden="true">${glyphs[icon]}</span>
            <div><strong>${title}</strong><p>${copy}</p></div>
          </div>`).join("")}
      </div>
    `;
  }

  if (typeof MutationObserver === "function") {
    new MutationObserver(render).observe(setup, {attributes: true, attributeFilter: ["data-mode"]});
  }
  render();
})();

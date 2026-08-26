(() => {
  "use strict";

  const profile = document.getElementById("screenProfile");
  const settings = profile?.querySelector(".settingsList");
  if (!profile || !settings || document.getElementById("appearanceLayer")) return;

  const row = document.createElement("button");
  row.type = "button";
  row.className = "settingsListRow";
  row.dataset.profileTarget = "appearance";
  row.innerHTML = '<span>Appearance</span><span aria-hidden="true">›</span>';
  settings.insertBefore(row, settings.children[1] || null);

  const layer = document.createElement("div");
  layer.id = "appearanceLayer";
  layer.className = "appearanceLayer";
  layer.hidden = true;
  layer.innerHTML = `
    <section class="appearanceScreen" role="dialog" aria-modal="true" aria-labelledby="appearanceTitle">
      <header class="appearanceHeader"><button class="appearanceBack" type="button" aria-label="Back">‹</button><div><p class="screenEyebrow">Profile</p><h2 id="appearanceTitle">Appearance</h2></div></header>
      <p class="appearanceIntro">Choose how the main app screens look on this device.</p>
      <div class="appearanceOptions" role="radiogroup" aria-label="Appearance">
        <button type="button" class="appearanceOption" data-appearance-choice="system" role="radio">
          <span class="appearancePreview system" aria-hidden="true"></span><span class="appearanceOptionCopy"><strong>System</strong><span>Follow your device light or dark setting.</span></span><span class="appearanceCheck" aria-hidden="true">✓</span>
        </button>
        <button type="button" class="appearanceOption" data-appearance-choice="light" role="radio">
          <span class="appearancePreview light" aria-hidden="true"></span><span class="appearanceOptionCopy"><strong>Light</strong><span>Use the bright Lingua Relay interface.</span></span><span class="appearanceCheck" aria-hidden="true">✓</span>
        </button>
        <button type="button" class="appearanceOption" data-appearance-choice="dark" role="radio">
          <span class="appearancePreview dark" aria-hidden="true"></span><span class="appearanceOptionCopy"><strong>Dark</strong><span>Use the dark Lingua Relay interface.</span></span><span class="appearanceCheck" aria-hidden="true">✓</span>
        </button>
      </div>
      <p class="appearanceNote">Live video and voice conversation screens remain dark for media contrast and call controls.</p>
    </section>
  `;
  document.body.append(layer);

  function current() {
    const value = document.documentElement.dataset.appearance || "system";
    return ["system", "light", "dark"].includes(value) ? value : "system";
  }

  function paint() {
    const value = current();
    for (const button of layer.querySelectorAll("[data-appearance-choice]")) {
      const selected = button.dataset.appearanceChoice === value;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    }
  }

  function setAppearance(value) {
    if (!["system", "light", "dark"].includes(value)) return;
    document.documentElement.dataset.appearance = value;
    try { localStorage.setItem("lingua-relay.appearance", value); } catch (_) {}
    paint();
  }

  function open() {
    paint();
    layer.hidden = false;
    document.body.classList.add("profileDetailOpen");
    requestAnimationFrame(() => layer.classList.add("visible"));
    setTimeout(() => layer.querySelector(".appearanceOption.selected")?.focus?.(), 80);
  }

  function close() {
    layer.classList.remove("visible");
    document.body.classList.remove("profileDetailOpen");
    setTimeout(() => { layer.hidden = true; }, 150);
    row.focus();
  }

  row.addEventListener("click", open);
  layer.querySelector(".appearanceBack")?.addEventListener("click", close);
  for (const button of layer.querySelectorAll("[data-appearance-choice]")) {
    button.addEventListener("click", () => setAppearance(button.dataset.appearanceChoice));
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !layer.hidden) close();
  });
})();

(() => {
  "use strict";
  const profile = document.getElementById("screenProfile");
  if (!profile || document.getElementById("profileDetailLayer")) return;

  const layer = document.createElement("div");
  layer.id = "profileDetailLayer";
  layer.className = "profileDetailLayer";
  layer.hidden = true;
  layer.innerHTML = `
    <section class="profileDetail" data-profile-detail="privacy" hidden>
      <header class="profileDetailHeader"><button type="button" data-profile-back aria-label="Back">‹</button><div><p class="screenEyebrow">Profile</p><h2>Privacy & safety</h2></div></header>
      <div class="profileDetailHero"><div aria-hidden="true">✓</div><h3>Private conversation first</h3><p>Lingua Relay is built around temporary two-person rooms instead of public profiles or open channels.</p></div>
      <section class="profileDetailList">
        <div><span>2</span><p><strong>Two-person limit</strong>Only you and one conversation partner can be in a room.</p></div>
        <div><span>↗</span><p><strong>Private invitation</strong>The room link is the invitation. Share it only with the person you want to talk to.</p></div>
        <div><span>!</span><p><strong>Report & block</strong>Every live room includes a report-and-block action under More.</p></div>
        <div><span>≡</span><p><strong>Activity without transcript content</strong>The Activity tab keeps lightweight metadata, not the conversation text shown in the room.</p></div>
      </section>
      <button type="button" class="profileDetailAction" data-open-content="privacy">Read full privacy policy</button>
    </section>
    <section class="profileDetail" data-profile-detail="support" hidden>
      <header class="profileDetailHeader"><button type="button" data-profile-back aria-label="Back">‹</button><div><p class="screenEyebrow">Profile</p><h2>Help & support</h2></div></header>
      <div class="profileDetailHero"><div aria-hidden="true">?</div><h3>How Lingua Relay works</h3><p>Create or join a private room, choose your language, and use video, voice, or chat with live translation.</p></div>
      <section class="profileDetailList">
        <div><span>1</span><p><strong>Create or join</strong>Hosts sign in to create a room. Guests can join a valid invitation without an account.</p></div>
        <div><span>2</span><p><strong>Choose your language</strong>Each person picks the language they want to speak and read.</p></div>
        <div><span>3</span><p><strong>Allow features you use</strong>Voice needs microphone access. Video adds camera access. Chat needs neither.</p></div>
        <div><span>4</span><p><strong>Leave or close</strong>Guests leave a room; hosts can close it so the invitation stops working.</p></div>
      </section>
      <button type="button" class="profileDetailAction" data-open-content="support">Open support</button>
    </section>
  `;
  document.body.append(layer);

  function openDetail(name) {
    const detail = layer.querySelector(`[data-profile-detail="${name}"]`);
    if (!detail) return;
    for (const section of layer.querySelectorAll("[data-profile-detail]")) section.hidden = section !== detail;
    layer.hidden = false;
    document.body.classList.add("profileDetailOpen");
    requestAnimationFrame(() => layer.classList.add("visible"));
    detail.querySelector("[data-profile-back]")?.focus?.();
  }

  function closeDetail() {
    layer.classList.remove("visible");
    document.body.classList.remove("profileDetailOpen");
    setTimeout(() => { layer.hidden = true; }, 150);
  }

  for (const name of ["privacy", "support"]) {
    const button = profile.querySelector(`[data-profile-target="${name}"]`);
    button?.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openDetail(name);
    }, {capture: true});
  }

  for (const button of layer.querySelectorAll("[data-profile-back]")) button.addEventListener("click", closeDetail);
  for (const button of layer.querySelectorAll("[data-open-content]")) {
    button.addEventListener("click", () => {
      const page = button.dataset.openContent;
      location.href = window.LinguaRuntime?.contentUrl?.(page) || `/${page}.html`;
    });
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !layer.hidden) closeDetail();
  });
})();

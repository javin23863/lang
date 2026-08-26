(() => {
  "use strict";
  const screen = document.getElementById("screenHome");
  const runtime = window.LinguaRuntime;
  if (!screen || !runtime) return;

  const card = document.createElement("section");
  card.className = "joinRoomCard screenCard";
  card.innerHTML = `
    <div class="joinRoomIcon" aria-hidden="true">↘</div>
    <div class="joinRoomCopy"><strong>Have an invitation?</strong><span>Paste a Lingua Relay private-room link to join someone else.</span></div>
    <button id="joinExistingBtn" type="button">Join a room</button>
  `;
  const roomPanel = document.getElementById("roomPanel");
  screen.insertBefore(card, roomPanel || null);

  const layer = document.createElement("div");
  layer.id = "joinRoomLayer";
  layer.className = "joinRoomLayer";
  layer.hidden = true;
  layer.innerHTML = `
    <div class="joinRoomScrim" data-join-close></div>
    <section class="joinRoomSheet" role="dialog" aria-modal="true" aria-labelledby="joinRoomTitle">
      <div class="setupHandle" aria-hidden="true"></div>
      <header class="joinRoomHeader">
        <button type="button" class="setupClose" data-join-close aria-label="Close">×</button>
        <div class="joinRoomBigIcon" aria-hidden="true">↘</div>
        <p class="screenEyebrow">Join a conversation</p>
        <h2 id="joinRoomTitle">Open an invitation</h2>
        <p>Paste the private room link you received. Lingua Relay will validate it before opening anything.</p>
      </header>
      <label class="joinLinkField"><span>Invitation link</span><input id="joinRoomInput" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…"></label>
      <div class="joinRoomActions">
        <button id="pasteInviteBtn" type="button">Paste</button>
        <button id="openInviteBtn" class="primary" type="button">Open invitation</button>
      </div>
      <p id="joinRoomError" class="joinRoomError" role="status" aria-live="polite"></p>
    </section>
  `;
  document.body.append(layer);

  const input = document.getElementById("joinRoomInput");
  const error = document.getElementById("joinRoomError");
  const openButton = document.getElementById("openInviteBtn");
  const pasteButton = document.getElementById("pasteInviteBtn");

  function show() {
    error.textContent = "";
    input.value = "";
    layer.hidden = false;
    document.body.classList.add("setupOpen");
    requestAnimationFrame(() => layer.classList.add("visible"));
    setTimeout(() => input.focus(), 170);
  }

  function hide() {
    layer.classList.remove("visible");
    document.body.classList.remove("setupOpen");
    setTimeout(() => { layer.hidden = true; }, 150);
    document.getElementById("joinExistingBtn")?.focus();
  }

  function parseInvite(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.origin !== runtime.publicOrigin || url.hash) return null;
      const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43})$/);
      if (!match) return null;
      const mode = url.searchParams.get("m");
      const allowedMode = mode === "voice" || mode === "chat" || mode === "video" ? mode : "video";
      const allowedKeys = new Set(["m", "n"]);
      if ([...url.searchParams.keys()].some(key => !allowedKeys.has(key))) return null;
      return {path: `/room/${match[1]}`, mode: allowedMode};
    } catch (_) {
      return null;
    }
  }

  function openInvite() {
    const invite = parseInvite(input.value);
    if (!invite) {
      error.textContent = "That does not look like a valid Lingua Relay invitation.";
      input.focus();
      return;
    }
    error.textContent = "";
    const opened = runtime.openRoom(invite.path, invite.mode);
    if (!opened) error.textContent = "The invitation could not be opened on this device.";
  }

  document.getElementById("joinExistingBtn").addEventListener("click", show);
  for (const closer of layer.querySelectorAll("[data-join-close]")) closer.addEventListener("click", hide);
  openButton.addEventListener("click", openInvite);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      openInvite();
    }
  });
  pasteButton.addEventListener("click", async () => {
    try {
      const value = await navigator.clipboard?.readText?.();
      if (value) {
        input.value = value;
        error.textContent = "";
      }
    } catch (_) {
      input.focus();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !layer.hidden) hide();
  });
})();

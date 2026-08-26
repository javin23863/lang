(() => {
  "use strict";

  const screen = document.getElementById("screenActivity");
  const list = document.getElementById("recentConversationList");
  if (!screen || !list) return;

  const RECENT_KEY = "lingua-relay.recent-conversations.v1";
  const modeLabel = mode => mode === "voice" ? "Voice call" : mode === "chat" ? "Text chat" : "Video call";
  const modeGlyph = mode => mode === "voice" ? "◉" : mode === "chat" ? "✦" : "▣";

  const layer = document.createElement("div");
  layer.id = "activityDetailLayer";
  layer.className = "activityDetailLayer";
  layer.hidden = true;
  layer.innerHTML = `
    <div class="activityDetailScrim" data-activity-close></div>
    <section class="activityDetailSheet" role="dialog" aria-modal="true" aria-labelledby="activityDetailTitle">
      <div class="setupHandle" aria-hidden="true"></div>
      <header class="activityDetailHeader">
        <button type="button" class="activityDetailClose" data-activity-close aria-label="Close">×</button>
        <div id="activityDetailGlyph" class="activityDetailGlyph" aria-hidden="true">▣</div>
        <p class="screenEyebrow">Conversation</p>
        <h2 id="activityDetailTitle">Video call</h2>
        <p id="activityDetailTime"></p>
      </header>
      <div class="activityDetailPair">
        <div><span>You spoke</span><strong id="activityDetailMine">—</strong></div>
        <div class="activityDetailArrow" aria-hidden="true">↔</div>
        <div><span>Other language</span><strong id="activityDetailTheirs">—</strong></div>
      </div>
      <div class="activityPrivacyNote"><span aria-hidden="true">✓</span><p>Only conversation metadata is shown here. Lingua Relay does not place message or transcript content in this activity view.</p></div>
      <button id="activityRepeat" class="activityRepeat" type="button">Start another conversation</button>
    </section>
  `;
  document.body.append(layer);

  let activeItem = null;
  let returnRow = null;

  function rows() {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(value) ? value.slice(0, 8) : [];
    } catch (_) {
      return [];
    }
  }

  function decorateRows() {
    for (const row of list.querySelectorAll(".recentRow")) {
      if (row.dataset.activityReady === "1") continue;
      row.dataset.activityReady = "1";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `View ${row.querySelector("strong")?.textContent || "conversation"} details`);
      const affordance = document.createElement("span");
      affordance.className = "recentDisclosure";
      affordance.setAttribute("aria-hidden", "true");
      affordance.textContent = "›";
      row.append(affordance);
    }
  }

  function open(index, row) {
    const item = rows()[index];
    if (!item) return;
    activeItem = item;
    returnRow = row;
    document.getElementById("activityDetailGlyph").textContent = modeGlyph(item.mode);
    document.getElementById("activityDetailTitle").textContent = modeLabel(item.mode);
    document.getElementById("activityDetailMine").textContent = item.mine || "Not recorded";
    document.getElementById("activityDetailTheirs").textContent = item.theirs || "Not recorded";
    const date = new Date(item.at);
    document.getElementById("activityDetailTime").textContent = Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"}).format(date)
      : "Recent conversation";
    const repeat = document.getElementById("activityRepeat");
    repeat.textContent = `Start another ${modeLabel(item.mode).toLowerCase()}`;
    layer.dataset.mode = item.mode || "video";
    layer.hidden = false;
    document.body.classList.add("setupOpen");
    requestAnimationFrame(() => layer.classList.add("visible"));
    setTimeout(() => repeat.focus(), 160);
  }

  function close() {
    layer.classList.remove("visible");
    document.body.classList.remove("setupOpen");
    setTimeout(() => { layer.hidden = true; }, 150);
    returnRow?.focus?.();
  }

  list.addEventListener("click", event => {
    const row = event.target.closest?.(".recentRow");
    if (!row) return;
    open([...list.querySelectorAll(".recentRow")].indexOf(row), row);
  });
  list.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest?.(".recentRow");
    if (!row) return;
    event.preventDefault();
    open([...list.querySelectorAll(".recentRow")].indexOf(row), row);
  });
  for (const closer of layer.querySelectorAll("[data-activity-close]")) closer.addEventListener("click", close);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !layer.hidden) close();
  });
  document.getElementById("activityRepeat")?.addEventListener("click", () => {
    const mode = activeItem?.mode || "video";
    close();
    window.LinguaDashboardShell?.selectTab?.("home");
    window.LinguaDashboardShell?.openConversationSetup?.(mode);
  });

  decorateRows();
  if (typeof MutationObserver === "function") {
    new MutationObserver(decorateRows).observe(list, {childList: true});
  }
})();

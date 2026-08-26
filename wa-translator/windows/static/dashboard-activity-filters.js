(() => {
  "use strict";

  const screen = document.getElementById("screenActivity");
  const list = document.getElementById("recentConversationList");
  const card = list?.closest?.(".recentCard");
  if (!screen || !list || !card || document.getElementById("activityFilters")) return;

  const filters = document.createElement("div");
  filters.id = "activityFilters";
  filters.className = "activityFilters";
  filters.setAttribute("role", "tablist");
  filters.setAttribute("aria-label", "Conversation type");
  for (const [value, label] of [["all", "All"], ["video", "Video"], ["voice", "Voice"], ["chat", "Chat"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.activityFilter = value;
    button.setAttribute("role", "tab");
    button.textContent = label;
    filters.append(button);
  }
  card.before(filters);

  const empty = document.createElement("div");
  empty.id = "activityFilterEmpty";
  empty.className = "activityFilterEmpty screenCard";
  empty.hidden = true;
  empty.innerHTML = '<strong>No conversations in this view</strong><span>Try another filter or start a new conversation from Home.</span>';
  card.after(empty);

  let active = "all";
  function apply() {
    let visible = 0;
    const rows = [...list.querySelectorAll(".recentRow")];
    for (const row of rows) {
      const mode = row.querySelector(".recentModeIcon")?.dataset.mode || "video";
      const show = active === "all" || mode === active;
      row.hidden = !show;
      if (show) visible++;
    }
    empty.hidden = !rows.length || visible > 0;
    for (const button of filters.querySelectorAll("[data-activity-filter]")) {
      const selected = button.dataset.activityFilter === active;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  filters.addEventListener("click", event => {
    const button = event.target.closest?.("[data-activity-filter]");
    if (!button) return;
    active = button.dataset.activityFilter;
    apply();
  });
  filters.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const values = ["all", "video", "voice", "chat"];
    const delta = event.key === "ArrowRight" ? 1 : -1;
    active = values[(values.indexOf(active) + delta + values.length) % values.length];
    apply();
    filters.querySelector(`[data-activity-filter="${active}"]`)?.focus();
    event.preventDefault();
  });

  if (typeof MutationObserver === "function") new MutationObserver(apply).observe(list, {childList: true});
  apply();
})();

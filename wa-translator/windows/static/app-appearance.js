(() => {
  "use strict";
  let appearance = "system";
  try { appearance = localStorage.getItem("lingua-relay.appearance") || "system"; } catch (_) {}
  if (!new Set(["system", "light", "dark"]).has(appearance)) appearance = "system";
  document.documentElement.dataset.appearance = appearance;
})();

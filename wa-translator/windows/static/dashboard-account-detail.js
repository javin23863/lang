(() => {
  "use strict";

  const profile = document.getElementById("screenProfile");
  const settings = profile?.querySelector(".settingsList");
  const accountName = document.getElementById("accountName");
  const signOut = document.getElementById("signOutBtn");
  const deleteAccount = document.getElementById("deleteAccountBtn");
  if (!profile || !settings || !accountName || document.getElementById("accountDetailLayer")) return;

  profile.classList.add("accountDetailEnabled");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "settingsListRow";
  row.dataset.profileTarget = "account";
  row.innerHTML = '<span>Account & data</span><span aria-hidden="true">›</span>';
  settings.insertBefore(row, settings.firstChild);

  const layer = document.createElement("div");
  layer.id = "accountDetailLayer";
  layer.className = "accountDetailLayer";
  layer.hidden = true;
  layer.innerHTML = `
    <section class="accountDetailScreen" role="dialog" aria-modal="true" aria-labelledby="accountDetailTitle">
      <header class="accountDetailHeader"><button class="accountDetailBack" type="button" aria-label="Back">‹</button><div><p class="screenEyebrow">Profile</p><h2 id="accountDetailTitle">Account & data</h2></div></header>
      <section class="accountIdentityCard">
        <div class="accountDetailAvatar" aria-hidden="true">LR</div>
        <div><strong id="accountDetailName">Lingua Relay account</strong><span>Signed in</span></div>
      </section>
      <section class="accountDataList">
        <button type="button" data-account-action="activity"><span><strong>Usage & activity</strong><small>Conversation metadata and account usage</small></span><span aria-hidden="true">›</span></button>
        <div><span><strong>Conversation content</strong><small>Not shown in Activity or this account screen</small></span><b>Private</b></div>
        <div><span><strong>Device preferences</strong><small>Languages, appearance, and call defaults stay on this device</small></span><b>Local</b></div>
      </section>
      <section class="accountActionsCard">
        <button type="button" data-account-action="signout">Sign out</button>
        <button type="button" class="danger" data-account-action="delete">Delete account</button>
      </section>
    </section>
  `;
  document.body.append(layer);

  function syncName() {
    document.getElementById("accountDetailName").textContent = accountName.textContent?.trim() || "Lingua Relay account";
  }
  function open() {
    syncName();
    layer.hidden = false;
    document.body.classList.add("profileDetailOpen");
    requestAnimationFrame(() => layer.classList.add("visible"));
    setTimeout(() => layer.querySelector(".accountDetailBack")?.focus?.(), 80);
  }
  function close() {
    layer.classList.remove("visible");
    document.body.classList.remove("profileDetailOpen");
    setTimeout(() => { layer.hidden = true; }, 150);
    row.focus();
  }

  row.addEventListener("click", open);
  layer.querySelector(".accountDetailBack")?.addEventListener("click", close);
  layer.querySelector('[data-account-action="activity"]')?.addEventListener("click", () => {
    close();
    window.LinguaDashboardShell?.selectTab?.("activity");
  });
  layer.querySelector('[data-account-action="signout"]')?.addEventListener("click", () => signOut?.click?.());
  layer.querySelector('[data-account-action="delete"]')?.addEventListener("click", () => deleteAccount?.click?.());
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !layer.hidden) close();
  });
  if (typeof MutationObserver === "function") new MutationObserver(syncName).observe(accountName, {childList: true, characterData: true, subtree: true});
  syncName();
})();

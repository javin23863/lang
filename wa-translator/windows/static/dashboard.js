const $ = id => document.getElementById(id);
const runtime = window.LinguaRuntime;
const dashboardFetch = window.LinguaDashboardApi.fetch;
const t = runtime.t;
const accountPresenter = window.LinguaDashboardAccount.create({
  runtime, fetch: dashboardFetch, t, byId: $
});
const roomModel = window.LinguaDashboardRoomModel.create(runtime);
const startupAuthFailed = new URLSearchParams(location.search).get("auth") === "failed";
let account = null;
let accountRefreshing = false;
let roomBusy = false;
let accountActionBusy = false;
// Every visible line is stored as its key, never as finished text, so a
// language switch can re-render the screen the person is already looking at.
let stateKey = "home.noRoom", stateParams = null, noticeKey = "", noticeParams = null;
let authStatusKey = "";

function setNotice(key, params) {
  noticeKey = key || "";
  noticeParams = params || null;
  $("roomNotice").textContent = noticeKey ? t(noticeKey, noticeParams) : "";
}

function setState(state, key, params) {
  stateKey = key;
  stateParams = params || null;
  $("roomState").dataset.state = state;
  $("roomState").textContent = t(key, params);
}

function hideQr() {
  $("qrBox").replaceChildren();
  $("qrBox").hidden = true;
  $("qrBtn").setAttribute("aria-expanded", "false");
}

function renderRoom(room, state, participantCount) {
  $("roomPanel").hidden = !room;
  if (!room) return;
  $("shareLink").value = roomModel.inviteUrl(room);
  const count = Number.isInteger(participantCount) && participantCount >= 0 && participantCount <= 2
    ? participantCount : 0;
  if (state !== "open") setState(state, "home.roomReady");
  else if (count === 1) setState(state, "home.roomOpenOne");
  else setState(state, "home.roomOpenMany", {count});
}

function handleRoomClear(state, key, options = {}) {
  if (options.preserveRoom !== true) {
    hideQr();
    $("roomPanel").hidden = true;
  }
  setState(state, key);
}

function syncBusyControls() {
  const blocked = roomBusy || accountActionBusy;
  for (const id of ["createVoiceBtn", "createChatBtn", "createBtn",
                    "copyBtn", "shareBtn", "openBtn", "closeBtn",
                    "waBtn", "lineBtn", "qrBtn",
                    "signOutBtn", "deleteAccountBtn"]) {
    $(id).disabled = blocked;
  }
}

function setBusy(value) {
  roomBusy = Boolean(value);
  syncBusyControls();
}

function setAccountBusy(value) {
  accountActionBusy = Boolean(value);
  syncBusyControls();
}

function setAuthStatus(key) {
  authStatusKey = key || "";
  $("authStatus").textContent = authStatusKey ? t(authStatusKey) : "";
}

function applyAccountAvailability() {
  if (account?.unavailable) {
    setAuthStatus("home.needsUpdate");
  } else if (authStatusKey === "home.needsUpdate") {
    setAuthStatus(startupAuthFailed ? "auth.failed" : "");
  }
}

async function refreshAccountIfUnavailable() {
  if (!account?.unavailable || accountRefreshing) return;
  accountRefreshing = true;
  try {
    const loaded = await accountPresenter.load();
    account = await reconcileAccountRoomCustody(loaded);
    accountPresenter.render(account);
    applyAccountAvailability();
  } finally {
    accountRefreshing = false;
  }
}

const roomController = window.LinguaDashboardRoomController.create({
  runtime,
  fetch: dashboardFetch,
  model: roomModel,
  events: () => window.LinguaProductEvents,
  confirmAction: key => window.confirm(t(key)),
  onBusy: setBusy,
  onNotice: setNotice,
  onRender: renderRoom,
  onClear: handleRoomClear,
});

async function reconcileAccountRoomCustody(snapshot) {
  if (snapshot.signed_in) {
    await roomController.restore();
    return snapshot;
  }
  // A transport/backend outage cannot prove an account transition. Keep the
  // encrypted bearer at rest, but do not restore or poll it until identity is known.
  if (snapshot.unavailable) return snapshot;
  try {
    // A confirmed signed-out state must not inherit a prior account's local
    // host-control bearer before another provider sign-in can be exposed.
    if (await roomController.discard()) return snapshot;
  } catch (_) {}
  // The controller always drops its in-memory bearer first. If persistent
  // retirement cannot be confirmed, keep provider entry points hidden until
  // storage recovers and this reconciliation can prove the bearer is retired.
  return {...snapshot, providers: [], unavailable: true};
}

const sharePresenter = window.LinguaDashboardShare.create({
  runtime,
  t,
  byId: $,
  getRoom: roomController.current,
  isBusy: roomController.isBusy,
  roomMode: roomModel.mode,
  roomUrl: roomModel.inviteUrl,
  setNotice,
  hideQr,
});
const settingsPresenter = window.LinguaDashboardSettings.create({runtime, byId: $});
const lifecycle = window.LinguaDashboardLifecycle.create({
  runtime,
  onVisible: () => {
    roomController.refresh();
    refreshAccountIfUnavailable();
  },
});

async function deleteAccount() {
  if (accountActionBusy || roomController.isBusy()) return;
  if (!window.confirm(t("auth.deleteConfirm"))) return;
  setAccountBusy(true);
  let serverDeleted = false;
  try {
    const response = await dashboardFetch(runtime.apiUrl("/api/account/delete"),
      {method: "POST", headers: {Accept: "application/json"}});
    if (!response.ok) throw new Error("delete failed");
    serverDeleted = true;
    // Host-control is account/device-local administration state. A successful
    // account deletion must remove it before another account can use this device.
    await roomController.discard();
    location.reload();
  } catch (_) {
    if (serverDeleted) {
      // The server-side deletion is irreversible. Reload into the signed-out
      // custody gate even if secure-storage cleanup needs to be retried there.
      location.reload();
      return;
    }
    setNotice("auth.deleteFailed");
  } finally {
    if (!serverDeleted) setAccountBusy(false);
  }
}

$("createVoiceBtn").onclick = () => roomController.create("voice");
$("createChatBtn").onclick = () => roomController.create("chat");
$("createBtn").onclick = () => roomController.create("video");
$("signOutBtn").onclick = async () => {
  if (accountActionBusy || roomController.isBusy()) return;
  setAccountBusy(true);
  let serverSignedOut = false;
  try {
    // Signing out retires room administration from this device. Close the
    // active room first so its invitation cannot outlive the only host control
    // capable of closing it.
    if (roomController.current() && !await roomController.close(false)) return;
    const response = await dashboardFetch(runtime.apiUrl("/auth/logout"), {
      method: "POST", headers: {Accept: "application/json"}
    });
    if (!response.ok) throw new Error("logout failed");
    serverSignedOut = true;
    await roomController.discard();
    location.reload();
  } catch (_) {
    if (serverSignedOut) {
      // The session cookie is already revoked. Reload so boot can retry strict
      // persistent-bearer cleanup instead of claiming that logout itself failed.
      location.reload();
      return;
    }
    setAuthStatus("auth.signOutFailed");
  } finally {
    if (!serverSignedOut) setAccountBusy(false);
  }
};
$("deleteAccountBtn").onclick = deleteAccount;
$("copyBtn").onclick = sharePresenter.copy;
$("shareBtn").onclick = sharePresenter.systemShare;
$("openBtn").onclick = roomController.open;
$("closeBtn").onclick = () => roomController.close(true);
$("waBtn").onclick = sharePresenter.whatsapp;
$("lineBtn").onclick = sharePresenter.line;
$("qrBtn").onclick = sharePresenter.toggleQr;
sharePresenter.applyPlatformVisibility();
settingsPresenter.install(() => {
  $("roomState").textContent = t(stateKey, stateParams);
  $("roomNotice").textContent = noticeKey ? t(noticeKey, noticeParams) : "";
  setAuthStatus(authStatusKey);
  accountPresenter.render(account);
});
lifecycle.install();

async function boot() {
  try {
    await lifecycle.ready();
  } catch (_) {
    setState("error", "home.needsUpdate");
    setBusy(true);
    return;
  }
  if (startupAuthFailed) setAuthStatus("auth.failed");
  account = await reconcileAccountRoomCustody(await accountPresenter.load());
  accountPresenter.render(account);
  applyAccountAvailability();
}
boot();

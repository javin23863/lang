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

function setBusy(value) {
  for (const id of ["createVoiceBtn", "createChatBtn", "createBtn",
                    "copyBtn", "shareBtn", "openBtn", "closeBtn",
                    "waBtn", "lineBtn", "qrBtn"]) {
    $(id).disabled = value;
  }
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
    account = await accountPresenter.load();
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
  if (!window.confirm(t("auth.deleteConfirm"))) return;
  try {
    const response = await dashboardFetch(runtime.apiUrl("/api/account/delete"),
      {method: "POST", headers: {Accept: "application/json"}});
    if (!response.ok) throw new Error("delete failed");
    // Host-control is account/device-local administration state. A successful
    // account deletion must remove it before another account can use this device.
    await roomController.discard();
    location.reload();
  } catch (_) {
    setNotice("auth.deleteFailed");
  }
}

$("createVoiceBtn").onclick = () => roomController.create("voice");
$("createChatBtn").onclick = () => roomController.create("chat");
$("createBtn").onclick = () => roomController.create("video");
$("signOutBtn").onclick = async () => {
  try {
    const response = await dashboardFetch(runtime.apiUrl("/auth/logout"), {
      method: "POST", headers: {Accept: "application/json"}
    });
    if (!response.ok) throw new Error("logout failed");
    await roomController.discard();
    location.reload();
  } catch (_) {
    setAuthStatus("auth.signOutFailed");
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
  account = await accountPresenter.load();
  accountPresenter.render(account);
  applyAccountAvailability();
  await roomController.restore();
}
boot();

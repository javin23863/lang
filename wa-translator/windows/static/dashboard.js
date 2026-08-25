const $ = id => document.getElementById(id);
const runtime = window.LinguaRuntime;
const dashboardFetch = window.LinguaDashboardApi.fetch;
const t = runtime.t;
const accountPresenter = window.LinguaDashboardAccount.create({
  runtime, fetch: dashboardFetch, t, byId: $
});
const roomModel = window.LinguaDashboardRoomModel.create(runtime);
let currentRoom = null;
let account = null;
let statusTimer = null;
let statusRefreshing = false;
let busy = false;
// Every visible line is stored as its key, never as finished text, so a
// language switch can re-render the screen the person is already looking at.
let stateKey = "home.noRoom", stateParams = null, noticeKey = "", noticeParams = null;
let authStatusKey = "";

function roomMode(room) {
  return roomModel.mode(room);
}

function roomUrl(room) {
  return roomModel.inviteUrl(room);
}

function validRoom(value) {
  return roomModel.valid(value);
}

async function loadRoom() {
  return roomModel.load();
}

async function saveRoom(room) {
  return roomModel.save(room);
}

async function forgetRoom() {
  await roomModel.forget();
}

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

function renderRoom(state, participantCount) {
  $("roomPanel").hidden = !currentRoom;
  if (!currentRoom) return;
  $("shareLink").value = roomUrl(currentRoom);
  const count = Number.isInteger(participantCount) && participantCount >= 0 && participantCount <= 2
    ? participantCount : 0;
  if (state !== "open") setState(state, "home.roomReady");
  else if (count === 1) setState(state, "home.roomOpenOne");
  else setState(state, "home.roomOpenMany", {count});
}

function setBusy(value) {
  busy = value;
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

async function deleteAccount() {
  if (!window.confirm(t("auth.deleteConfirm"))) return;
  try {
    const response = await dashboardFetch(runtime.apiUrl("/api/account/delete"),
      {method: "POST", headers: {Accept: "application/json"}});
    if (!response.ok) throw new Error("delete failed");
    // A room link remains independently valid until room expiry, but the local
    // host-control bearer belongs to the account/device session that created it.
    // Do not let the next account on a shared device inherit that control token.
    await forgetRoom();
    location.reload();
  } catch (_) {
    setNotice("auth.deleteFailed");
  }
}

function stopPolling() {
  clearInterval(statusTimer);
  statusTimer = null;
}

// The invite link is a bearer token: its code lives only as long as the room it
// opens, so a room that changed or ended leaves no scannable copy behind.
function hideQr() {
  $("qrBox").replaceChildren();
  $("qrBox").hidden = true;
  $("qrBtn").setAttribute("aria-expanded", "false");
}

async function clearCurrentRoom(state, key) {
  await forgetRoom();
  currentRoom = null;
  stopPolling();
  hideQr();
  $("roomPanel").hidden = true;
  setState(state, key);
}

function startPolling() {
  stopPolling();
  if (!currentRoom) return;
  statusTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshStatus();
  }, 15000);
}

async function refreshStatus() {
  if (!currentRoom || busy || statusRefreshing) return;
  statusRefreshing = true;
  try {
    const response = await dashboardFetch(runtime.apiUrl("/api/room-control"), {
      headers: {Authorization: "Bearer " + currentRoom.host_control, Accept: "application/json"}
    });
    if (response.status === 403) {
      await clearCurrentRoom("expired", "home.controlLost");
      return;
    }
    if (!response.ok) throw new Error("status unavailable");
    const value = await response.json();
    if (value.participant_limit !== 2) throw new Error("participant contract mismatch");
    if (value.state === "closed") {
      await clearCurrentRoom("closed", "home.roomClosed");
      return;
    }
    if (value.state !== "ready" && value.state !== "open") throw new Error("invalid room state");
    renderRoom(value.state, value.participant_count);
    setNotice("");
  } catch (_) {
    setState("error", "home.statusUnavailable");
  } finally {
    statusRefreshing = false;
  }
}

async function createRoom(mode) {
  if (busy) return;
  const requestedMode = roomModel.normalizeMode(mode);
  if (currentRoom) {
    if (!window.confirm(t("home.confirmReplace"))) return;
    await closeRoom(false);
    if (currentRoom) return;
  }
  setBusy(true);
  setNotice("");
  try {
    const response = await dashboardFetch(runtime.apiUrl("/api/rooms"), {
      method: "POST", headers: {Accept: "application/json"}
    });
    if (!response.ok) throw new Error("creation failed");
    const room = await response.json();
    if (!validRoom(room)) throw new Error("storage unavailable");
    // Mode is local presentation metadata; the server signs only the room.
    room.mode = requestedMode;
    if (!await saveRoom(room)) throw new Error("storage unavailable");
    currentRoom = room;
    hideQr();
    renderRoom("ready", 0);
    startPolling();
    window.LinguaProductEvents?.emit("room.create.result", {mode: requestedMode, result: "success"});
    setNotice("home.linkReady");
  } catch (_) {
    window.LinguaProductEvents?.emit("room.create.result", {mode: requestedMode, result: "failure"});
    setState("error", "home.createFailed");
  } finally {
    setBusy(false);
  }
}

async function copyLink() {
  if (!currentRoom || busy) return;
  const link = roomUrl(currentRoom);
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(link);
    else {
      $("shareLink").focus();
      $("shareLink").select();
      if (!document.execCommand("copy")) throw new Error("copy failed");
    }
    setNotice("home.linkCopied");
  } catch (_) {
    $("shareLink").focus();
    $("shareLink").select();
    setNotice("home.selectToCopy");
  }
}

const SHARE_TEXT = {voice: "share.textVoice", chat: "share.textChat", video: "share.textVideo"};

function shareMessage() {
  return t(SHARE_TEXT[roomMode(currentRoom)]) + " " + roomUrl(currentRoom);
}

function openShareApp(url) {
  const opened = window.open(url, "_blank", "noopener");
  if (opened) opened.opener = null;
  else setNotice("home.openBlocked");
}

async function shareLink() {
  if (!currentRoom || busy) return;
  const link = roomUrl(currentRoom);
  if (await runtime.share({
    title: t("share.title"),
    text: t(SHARE_TEXT[roomMode(currentRoom)]),
    url: link
  })) {
    setNotice("home.linkShared");
    return;
  }
  await copyLink();
}

function openRoom() {
  if (!currentRoom || busy) return;
  // Pass the bearer path, not the whole saved record, so legacy local metadata
  // can never be promoted into a public navigation URL.
  if (!runtime.openRoom(currentRoom.path, roomMode(currentRoom))) {
    setNotice("home.openBlocked");
  }
}

async function closeRoom(withConfirmation = true) {
  if (!currentRoom || busy) return;
  if (withConfirmation && !window.confirm(t("home.confirmClose"))) return;
  setBusy(true);
  try {
    const response = await dashboardFetch(runtime.apiUrl("/api/room-control/close"), {
      method: "POST",
      headers: {Authorization: "Bearer " + currentRoom.host_control, Accept: "application/json"}
    });
    if (!response.ok) throw new Error("close failed");
    window.LinguaProductEvents?.emit("room.close.result", {result: "success"});
    await clearCurrentRoom("closed", "home.roomClosedLink");
    setNotice("");
  } catch (_) {
    window.LinguaProductEvents?.emit("room.close.result", {result: "failure"});
    setState("error", "home.closeFailed");
  } finally {
    setBusy(false);
  }
}

$("createVoiceBtn").onclick = () => createRoom("voice");
$("createChatBtn").onclick = () => createRoom("chat");
$("createBtn").onclick = () => createRoom("video");
$("signOutBtn").onclick = async () => {
  try {
    const response = await dashboardFetch(runtime.apiUrl("/auth/logout"), {
      method: "POST", headers: {Accept: "application/json"}
    });
    if (!response.ok) throw new Error("logout failed");
    // Logout revokes only this account session. Remove its local host-control
    // bearer as well so a later account on the device cannot inherit room admin.
    await forgetRoom();
    location.reload();
  } catch (_) {
    setAuthStatus("auth.signOutFailed");
  }
};
$("deleteAccountBtn").onclick = deleteAccount;
$("copyBtn").onclick = copyLink;
$("shareBtn").onclick = shareLink;
$("openBtn").onclick = openRoom;
$("closeBtn").onclick = () => closeRoom(true);
$("waBtn").onclick = () => {
  if (currentRoom && !busy) openShareApp("https://wa.me/?text=" + encodeURIComponent(shareMessage()));
};
// The /R/share form carries the sentence with the link; the
// social-plugins form takes a url alone and drops it.
$("lineBtn").onclick = () => {
  if (currentRoom && !busy) openShareApp("https://line.me/R/share?text=" + encodeURIComponent(shareMessage()));
};
// Drawn on the tap that asks for it, never on load: the link inside is the
// bearer token that opens the room.
$("qrBtn").onclick = () => {
  if (!currentRoom || busy) return;
  if (!$("qrBox").hidden) {
    hideQr();
    return;
  }
  $("qrBox").replaceChildren(window.LinguaQR.svg(roomUrl(currentRoom)));
  $("qrBox").hidden = false;
  $("qrBtn").setAttribute("aria-expanded", "true");
};
// In a native shell window.open navigates the dashboard away, and the system
// share sheet already lists both apps. The QR stays: it is the WeChat path.
if (runtime.isNative) {
  $("waBtn").hidden = true;
  $("lineBtn").hidden = true;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshStatus();
});
if (!runtime.isNative && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
// The dashboard is the first screen a host sees, before any room and before
// the room's own language gate — so the choice has to be offered here too.
// Native language names come from the platform rather than a catalog fetch.
function fillAppLocaleSelect() {
  const select = $("appLocaleSel");
  const named = runtime.i18n.languages.map(code => {
    let label = code;
    try {
      label = new Intl.DisplayNames([code], {type: "language"}).of(code) || code;
    } catch (_) { /* an unknown tag keeps its code */ }
    return {code, label: label.charAt(0).toLocaleUpperCase(code) + label.slice(1)};
  }).sort((left, right) => left.label.localeCompare(right.label));
  select.replaceChildren();
  for (const {code, label} of named) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = label;
    option.selected = code === runtime.i18n.language;
    select.appendChild(option);
  }
}
fillAppLocaleSelect();
$("appLocaleSel").onchange = () => runtime.i18n.use($("appLocaleSel").value);

// A language switch re-renders whatever is already on screen: the live status
// line and the notice both carry a key, not finished text.
runtime.i18n.onChange(() => {
  $("appLocaleSel").value = runtime.i18n.language;
  $("roomState").textContent = t(stateKey, stateParams);
  $("roomNotice").textContent = noticeKey ? t(noticeKey, noticeParams) : "";
  setAuthStatus(authStatusKey);
  accountPresenter.render(account);
});

async function boot() {
  try {
    await runtime.ready();
  } catch (_) {
    setState("error", "home.needsUpdate");
    setBusy(true);
    return;
  }
  if (new URLSearchParams(location.search).get("auth") === "failed") setAuthStatus("auth.failed");
  account = await accountPresenter.load();
  accountPresenter.render(account);
  currentRoom = await loadRoom();
  if (currentRoom && currentRoom.expires_at * 1000 > Date.now()) {
    renderRoom("ready", 0);
    startPolling();
    refreshStatus();
  } else if (currentRoom) {
    await forgetRoom();
    currentRoom = null;
    setState("expired", "home.roomExpired");
  }
}
boot();

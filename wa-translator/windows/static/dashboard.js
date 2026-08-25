const $ = id => document.getElementById(id);
const runtime = window.LinguaRuntime;
const t = runtime.t;
let currentRoom = null;
let account = null;
let statusTimer = null;
let busy = false;
// Every visible line is stored as its key, never as finished text, so a
// language switch can re-render the screen the person is already looking at.
let stateKey = "home.noRoom", stateParams = null, noticeKey = "", noticeParams = null;
let authStatusKey = "";

// The three surfaces a room can open as. Video is the mode that needs no
// parameter, so every link made before modes existed still opens a video call.
const MODES = new Set(["voice", "chat", "video"]);
// Google is provisioned day one and leads the list; the others appear only
// when the worker reports credentials for them.
const PROVIDERS = [["google", "signInGoogle"], ["apple", "signInApple"],
                   ["facebook", "signInFacebook"]];
const USAGE_KIND = {call: "credits.callMinutes", chat: "credits.chatMessages",
                    tts: "credits.ttsPhrases"};

function roomMode(room) {
  return MODES.has(room?.mode) ? room.mode : "video";
}

function roomUrl(room) {
  const url = new URL(runtime.inviteUrl(room));
  const mode = roomMode(room);
  if (mode !== "video") url.searchParams.set("m", mode);
  // Shareable bearer URLs carry only the room credential and call mode. Do not
  // add human names or other account/device labels to messages, QR codes,
  // browser history, edge logs, or analytics surfaces.
  return url.toString();
}

// `mode` is optional on purpose: a record saved before modes existed is still
// a valid room and still opens. Legacy local-only fields are simply ignored.
function validRoom(value) {
  return value && typeof value.path === "string" && typeof value.host_control === "string"
    && Number.isSafeInteger(value.expires_at);
}

async function loadRoom() {
  try {
    const value = JSON.parse(await runtime.loadHostRoom() || "null");
    return validRoom(value) ? value : null;
  } catch (_) {
    return null;
  }
}

async function saveRoom(room) {
  try {
    return runtime.saveHostRoom(JSON.stringify(room));
  } catch (_) {
    return false;
  }
}

async function forgetRoom() {
  await runtime.forgetHostRoom();
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

// ── Account and sign-in ───────────────────────────────────
async function loadAccount() {
  try {
    // Browser sessions ride same-origin cookies. The native bridge attaches its
    // securely stored bearer only to the versioned account/room-creation API.
    const response = await fetch(runtime.apiUrl("/api/me"), {headers: {Accept: "application/json"}});
    if (!response.ok) throw new Error("account unavailable");
    return await response.json();
  } catch (_) {
    // An unreachable worker is a signed-out screen with no provider to offer,
    // never a blank page.
    return {signed_in: false, providers: []};
  }
}

function setAuthStatus(key) {
  authStatusKey = key || "";
  $("authStatus").textContent = authStatusKey ? t(authStatusKey) : "";
}

function renderProviders() {
  const offered = Array.isArray(account?.providers) ? account.providers : [];
  const box = $("authButtons");
  box.replaceChildren();
  for (const [provider, id] of PROVIDERS) {
    if (!offered.includes(provider)) continue;
    const link = document.createElement("a");
    link.id = id;
    link.className = "signIn";
    link.href = runtime.apiUrl("/auth/" + provider + "/start");
    // The runtime repaints anything carrying a key, so these labels follow a
    // language change for free.
    link.dataset.i18n = "auth." + id;
    link.textContent = t(link.dataset.i18n);
    box.appendChild(link);
  }
}

function renderAccount() {
  if (!account) return;   // /api/me has not answered yet: show neither side
  document.body.dataset.auth = account.signed_in ? "in" : "out";
  renderProviders();
  if (!account?.signed_in) return;
  $("accountName").textContent = t("auth.signedInAs", {name: account.user?.name || ""});
  const rows = Array.isArray(account.recent) ? account.recent.slice(0, 20) : [];
  const list = $("usageList");
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.textContent = t("credits.usageEmpty");
    list.appendChild(empty);
    return;
  }
  for (const row of rows) {
    const item = document.createElement("li");
    const when = document.createElement("span");
    when.className = "when";
    const at = new Date(row.at);
    when.textContent = Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString(runtime.i18n.locale);
    const what = document.createElement("span");
    // The unit count sits inside the sentence, so a language that puts the
    // number last still reads correctly.
    what.textContent = USAGE_KIND[row.kind]
      ? t(USAGE_KIND[row.kind], {count: Number(row.units) || 0}) : String(row.units);
    item.append(when, what);
    list.appendChild(item);
  }
}

async function deleteAccount() {
  if (!window.confirm(t("auth.deleteConfirm"))) return;
  try {
    const response = await fetch(runtime.apiUrl("/api/account/delete"),
                                 {method: "POST", headers: {Accept: "application/json"}});
    if (!response.ok) throw new Error("delete failed");
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
  if (!currentRoom || busy) return;
  try {
    const response = await fetch(runtime.apiUrl("/api/room-control"), {
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
  }
}

async function createRoom(mode) {
  if (busy) return;
  if (currentRoom) {
    if (!window.confirm(t("home.confirmReplace"))) return;
    await closeRoom(false);
    if (currentRoom) return;
  }
  setBusy(true);
  setNotice("");
  try {
    const response = await fetch(runtime.apiUrl("/api/rooms"), {
      method: "POST", headers: {Accept: "application/json"}
    });
    if (!response.ok) throw new Error("creation failed");
    const room = await response.json();
    if (!validRoom(room)) throw new Error("storage unavailable");
    // Mode is local presentation metadata; the server signs only the room.
    room.mode = MODES.has(mode) ? mode : "video";
    if (!await saveRoom(room)) throw new Error("storage unavailable");
    currentRoom = room;
    hideQr();
    renderRoom("ready", 0);
    startPolling();
    setNotice("home.linkReady");
  } catch (_) {
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
    const response = await fetch(runtime.apiUrl("/api/room-control/close"), {
      method: "POST",
      headers: {Authorization: "Bearer " + currentRoom.host_control, Accept: "application/json"}
    });
    if (!response.ok) throw new Error("close failed");
    await clearCurrentRoom("closed", "home.roomClosedLink");
    setNotice("");
  } catch (_) {
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
    await fetch(runtime.apiUrl("/auth/logout"), {method: "POST", headers: {Accept: "application/json"}});
  } catch (_) { /* the reload re-reads the session either way */ }
  location.reload();
};
$("deleteAccountBtn").onclick = deleteAccount;
$("copyBtn").onclick = copyLink;
$("shareBtn").onclick = shareLink;
$("openBtn").onclick = openRoom;
$("closeBtn").onclick = () => closeRoom(true);
$("waBtn").onclick = () => {
  if (currentRoom && !busy) openShareApp("https://wa.me/?text=" + encodeURIComponent(shareMessage()));
};
// The /R/share form carries the sentence and the link together; the
// social-plugins form takes a url only and drops it.
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
  renderAccount();
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
  account = await loadAccount();
  renderAccount();
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

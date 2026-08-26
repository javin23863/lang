import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.resolve(MOBILE, "..", "windows", "static");
const WWW = path.resolve(MOBILE, "www");
const FOUR_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 4 people<';
const TWO_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 2 people<';
const ROOM_STYLE_PATTERN = /<style>\n([\s\S]*?)\n<\/style>/;
const ROOM_SCRIPT_PATTERN = /<script>\n(const \$ = \(id\) => document\.getElementById\(id\);[\s\S]*?)\n<\/script>\n<\/body>/;
const STATUS_STYLE_SEAM = "el.style.display = text ? 'block' : 'none';";
const STATUS_TIMEOUT_SEAM = "setTimeout(() => { if (el.textContent === text) el.style.display = 'none'; }, 3000);";
const PARTICIPANT_COUNT_SEAM = "const derived = myId === null ? 0 : peers.size + 1;\n  participantCount = Number.isInteger(serverCount) && serverCount >= 0 && serverCount <= 4\n    ? serverCount : derived;";
const PARTICIPANT_COUNT_TWO_PERSON = "const derived = myId === null ? 0 : Math.min(2, peers.size + 1);\n  participantCount = Number.isInteger(serverCount) && serverCount >= 0 && serverCount <= 2\n    ? serverCount : derived;";
const WELCOME_SEAM = "if (m.type === 'welcome') {";
const WELCOME_TWO_PERSON = "if (m.type === 'welcome') {\n    if (m.participant_limit !== 2 || !Array.isArray(m.peers) || m.peers.length > 1) {\n      terminalRoom = true;\n      setStatus('gate.updateRequired', null, true);\n      ws.close(1008, 'participant contract mismatch');\n      return;\n    }";
const AUDIO_ENDED_SEAM = "if (micOn) setMicEnabled(false);";
const AUDIO_ENDED_RECOVERY = "if (micOn) {\n            setMicEnabled(false);\n            setStatus('status.micUnavailable', null, true);\n          }";
const VIDEO_ENDED_SEAM = "camOn = false;\n          $('camBtn').className = 'icon off';";
const VIDEO_ENDED_RECOVERY = "camOn = false;\n          $('camBtn').className = 'icon off';\n          setStatus('status.cameraUnavailable', null, true);";
const SOCKET_TEARDOWN_SEAM = "if (!preserveServerClose && ws && ws.readyState === WebSocket.OPEN) {\n    ws.close(1000, notifyServer ? 'left room' : 'page suspended');\n  }";
const SOCKET_TEARDOWN_SAFE = "if (!preserveServerClose && ws && ws.readyState < WebSocket.CLOSING) {\n    try { ws.close(1000, notifyServer ? 'left room' : 'page suspended'); } catch (_) {}\n  }";
const CONNECTION_STATE_SEAM = "let ws, myId = null, ttsToken = null, myLang = null, myLocale = null;";
const CONNECTION_STATE_GUARDED = "let ws, myId = null, ttsToken = null, myLang = null, myLocale = null;\nlet connectGeneration = 0;";
const CONNECT_SEAM = "async function connect() {\n  if (leaving) return;\n  if (!await preflightRoom()) return;\n  await refreshIceServers();\n  ws = new WebSocket(runtime.websocketUrl(roomId));";
const CONNECT_GUARDED = "async function connect() {\n  if (leaving) return;\n  if (ws && ws.readyState < WebSocket.CLOSING) return;\n  const generation = ++connectGeneration;\n  if (!await preflightRoom()) return;\n  if (leaving || generation !== connectGeneration) return;\n  await refreshIceServers();\n  if (leaving || generation !== connectGeneration) return;\n  ws = new WebSocket(runtime.websocketUrl(roomId));";
const DISCONNECT_SEAM = "function disconnectRoom(notifyServer, preserveServerClose = false) {\n  if (leaving) return;\n  leaving = true;";
const DISCONNECT_GUARDED = "function disconnectRoom(notifyServer, preserveServerClose = false) {\n  if (leaving) return;\n  leaving = true;\n  connectGeneration++;";
const CALL_GATE_SEAM = "const title = isHost ? 'call.call' : 'call.incoming';\n  const join = isHost ? 'call.call' : 'call.accept';";
const CALL_GATE_NEUTRAL = "const title = 'gate.title';\n  const join = 'gate.join';";
const CALL_GATE_BUTTON_SEAM = "$('joinBtn').classList.toggle('accept', !isHost);\n  $('declineBtn').hidden = isHost;";
const CALL_GATE_BUTTON_NEUTRAL = "$('joinBtn').classList.remove('accept');\n  $('declineBtn').hidden = true;";
const CALL_WAIT_SEAM = "setCallState('call.calling');";
const CALL_WAIT_NEUTRAL = "setCallState('stage.waiting');";
const CALL_RINGBACK_SEAM = "if (isHost) startRingback();";
const CALL_RINGBACK_NEUTRAL = "stopRingback();";
const WELCOME_CALL_SEAM = "if (roomMode === 'voice' && !isHost && m.peers.length) {\n      for (const peer of m.peers) send({type: 'signal', to: peer.id, data: {call: 'accept'}});\n      connectCall();\n    }";
const WELCOME_CALL_NEUTRAL = "if (roomMode === 'voice' && m.peers.length) {\n      for (const peer of m.peers) send({type: 'signal', to: peer.id, data: {call: 'accept'}});\n      connectCall();\n    }";
const PEER_JOIN_CALL_SEAM = "if (roomMode === 'voice' && isHost && !callTimerStart) {\n      setCallState('call.ringing');\n      startRingback();\n      updateCallButtons();\n    }";
const PEER_JOIN_CALL_NEUTRAL = "if (roomMode === 'voice' && !callTimerStart) {\n      send({type: 'signal', to: m.id, data: {call: 'accept'}});\n      connectCall();\n    }";
const TERMS_CHECKBOX_SEAM = '<input id="termsAgree" type="checkbox" checked>';
const TERMS_CHECKBOX_EXPLICIT = '<input id="termsAgree" type="checkbox">';
const TERMS_KEY_SEAM = "const termsKey = 'lingua-relay.terms.2026-08-14';";
const TERMS_KEY_CURRENT = "const termsKey = 'lingua-relay.terms.2026-08-25';";
const TERMS_BINDING_SEAM = "$('termsLink').href = runtime.contentUrl('terms');\n// The box arrives ticked; joining is the act of agreeing. Clearing it still\n// blocks Join, so the agreement is never assumed against an explicit refusal.\n$('termsAgree').onchange = updateRoleGate;";
const TERMS_BINDING_CURRENT = "$('termsLink').href = runtime.contentUrl('terms');\n// Consent is affirmative for this exact Terms version. First-time users see an\n// empty box; only a prior acceptance of the current version restores it.\n$('termsAgree').checked = localStorage.getItem(termsKey) === '1';\n$('termsAgree').onchange = updateRoleGate;\nupdateRoleGate();";
const ROOM_FETCH_HELPER_SEAM = "const blockedRoomKey = 'lingua-relay.blocked-room.' + roomId;";
const ROOM_FETCH_HELPER_CURRENT = "const blockedRoomKey = 'lingua-relay.blocked-room.' + roomId;\nconst ROOM_CONTROL_FETCH_TIMEOUT_MS = 12000;\nasync function roomFetch(input, init = {}) {\n  const controller = new AbortController();\n  const timer = setTimeout(() => controller.abort(), ROOM_CONTROL_FETCH_TIMEOUT_MS);\n  try {\n    return await fetch(input, {...init, signal: controller.signal});\n  } finally {\n    clearTimeout(timer);\n  }\n}";
const PEERS_SEAM = "const peers = new Map();   // id -> {pc, lang, polite, makingOffer, ignoreOffer}";
const PEERS_WITH_ICE_RECOVERY = `${PEERS_SEAM}\nconst ICE_RESTART_WINDOW_MS = 60 * 1000;\nconst ICE_RESTART_MAX_PER_WINDOW = 3;`;
const TURN_FAILURE_SEAM = "if (!response.ok) {\n        scheduleTurnRefresh(30000);\n        return;\n      }";
const TURN_FAILURE_RATE_LIMIT_SAFE = "if (!response.ok) {\n        const retryAfterSeconds = response.status === 429\n          ? Number(response.headers.get('Retry-After') || 0) : 0;\n        const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0\n          ? retryAfterSeconds * 1000 : 30000;\n        scheduleTurnRefresh(Math.max(30000, retryAfterMs));\n        return;\n      }";
const START_PEER_SEAM = "function startPeer(peer) {";
const START_PEER_WITH_ICE_RECOVERY = `function restartFailedIce(state) {\n  if (leaving || terminalRoom || !ws || ws.readyState !== WebSocket.OPEN) return false;\n  const now = Date.now();\n  state.iceRestartAttempts = (state.iceRestartAttempts || [])\n    .filter(attemptedAt => now - attemptedAt < ICE_RESTART_WINDOW_MS);\n  if (state.iceRestartAttempts.length >= ICE_RESTART_MAX_PER_WINDOW) return false;\n  state.iceRestartAttempts.push(now);\n  try {\n    state.pc.restartIce();\n    return true;\n  } catch (_) {\n    return false;\n  }\n}\n\nfunction startPeer(peer) {`;
const ICE_FAILURE_SEAM = "pc.oniceconnectionstatechange = () => {\n    if (pc.iceConnectionState === 'failed') {\n      failVoice('voice.naturalAudioRestored');\n      showVideoNote('note.videoFailed');\n    }\n  };";
const ICE_FAILURE_RECOVERY = "pc.oniceconnectionstatechange = () => {\n    if (pc.iceConnectionState === 'failed') {\n      restartFailedIce(state);\n      failVoice('voice.naturalAudioRestored');\n      showVideoNote('note.videoFailed');\n    }\n  };";
const CONTROL_FETCH_SEAMS = ["/api/capabilities", "/api/turn", "/api/room", "/api/reports"];
const ROOM_RUNTIME_MARKER = '<script src="/app-runtime.js"></script>';
const ROOM_CLIENT_SCRIPTS = `${ROOM_RUNTIME_MARKER}\n<script src="/product-events.js"></script>\n<script src="/room-product-events.js"></script>\n<script src="/room-blocking.js"></script>`;

if (path.dirname(WWW) !== MOBILE || path.basename(WWW) !== "www") {
  throw new Error(`Refusing unsafe mobile web target: ${WWW}`);
}

function normalizeRoomScript(source) {
  for (const seam of [
    STATUS_STYLE_SEAM, STATUS_TIMEOUT_SEAM, PARTICIPANT_COUNT_SEAM, WELCOME_SEAM,
    AUDIO_ENDED_SEAM, VIDEO_ENDED_SEAM, SOCKET_TEARDOWN_SEAM, CONNECTION_STATE_SEAM,
    CONNECT_SEAM, DISCONNECT_SEAM, CALL_GATE_SEAM, CALL_GATE_BUTTON_SEAM,
    CALL_WAIT_SEAM, CALL_RINGBACK_SEAM, WELCOME_CALL_SEAM, PEER_JOIN_CALL_SEAM,
    TERMS_KEY_SEAM, TERMS_BINDING_SEAM, ROOM_FETCH_HELPER_SEAM, PEERS_SEAM,
    TURN_FAILURE_SEAM, START_PEER_SEAM, ICE_FAILURE_SEAM,
  ]) {
    if (!source.includes(seam)) throw new Error(`room normalization seam is missing: ${seam.slice(0, 32)}`);
  }
  for (const path of CONTROL_FETCH_SEAMS) {
    const seam = `fetch(runtime.apiUrl('${path}')`;
    if (!source.includes(seam)) throw new Error(`room control fetch seam is missing: ${path}`);
  }
  let normalized = source
    .replace(STATUS_STYLE_SEAM, "el.hidden = !text;")
    .replace(STATUS_TIMEOUT_SEAM,
      "setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 3000);")
    .replace(PARTICIPANT_COUNT_SEAM, PARTICIPANT_COUNT_TWO_PERSON)
    .replace(WELCOME_SEAM, WELCOME_TWO_PERSON)
    .replace(AUDIO_ENDED_SEAM, AUDIO_ENDED_RECOVERY)
    .replace(VIDEO_ENDED_SEAM, VIDEO_ENDED_RECOVERY)
    .replace(SOCKET_TEARDOWN_SEAM, SOCKET_TEARDOWN_SAFE)
    .replace(CONNECTION_STATE_SEAM, CONNECTION_STATE_GUARDED)
    .replace(CONNECT_SEAM, CONNECT_GUARDED)
    .replace(DISCONNECT_SEAM, DISCONNECT_GUARDED)
    .replace(CALL_GATE_SEAM, CALL_GATE_NEUTRAL)
    .replace(CALL_GATE_BUTTON_SEAM, CALL_GATE_BUTTON_NEUTRAL)
    .replace(CALL_WAIT_SEAM, CALL_WAIT_NEUTRAL)
    .replace(CALL_RINGBACK_SEAM, CALL_RINGBACK_NEUTRAL)
    .replace(WELCOME_CALL_SEAM, WELCOME_CALL_NEUTRAL)
    .replace(PEER_JOIN_CALL_SEAM, PEER_JOIN_CALL_NEUTRAL)
    .replace(TERMS_KEY_SEAM, TERMS_KEY_CURRENT)
    .replace(TERMS_BINDING_SEAM, TERMS_BINDING_CURRENT)
    .replace(ROOM_FETCH_HELPER_SEAM, ROOM_FETCH_HELPER_CURRENT)
    .replace(PEERS_SEAM, PEERS_WITH_ICE_RECOVERY)
    .replace(TURN_FAILURE_SEAM, TURN_FAILURE_RATE_LIMIT_SAFE)
    .replace(START_PEER_SEAM, START_PEER_WITH_ICE_RECOVERY)
    .replace(ICE_FAILURE_SEAM, ICE_FAILURE_RECOVERY);
  for (const path of CONTROL_FETCH_SEAMS) {
    normalized = normalized.replace(`fetch(runtime.apiUrl('${path}')`, `roomFetch(runtime.apiUrl('${path}')`);
  }
  return normalized;
}

function enhanceRoomShell(source) {
  if (!source.includes(TERMS_CHECKBOX_SEAM)) {
    throw new Error("room shell is missing the explicit Terms-consent seam");
  }
  if (!source.includes(ROOM_RUNTIME_MARKER)) {
    throw new Error("room shell is missing the room client-script seam");
  }
  return source
    .replace(ROOM_RUNTIME_MARKER, ROOM_CLIENT_SCRIPTS)
    .replace(TERMS_CHECKBOX_SEAM, TERMS_CHECKBOX_EXPLICIT)
    .replace('<div id="videoNote">', '<div id="videoNote" role="status" aria-live="polite">')
    .replace('<div id="status">', '<div id="status" role="status" aria-live="polite">')
    .replace('<div id="captions">',
      '<div id="captions" role="log" aria-live="polite" aria-relevant="additions text">');
}

function decomposeRoom(source) {
  const style = source.match(ROOM_STYLE_PATTERN);
  const script = source.match(ROOM_SCRIPT_PATTERN);
  if (!style || !script) throw new Error("room source decomposition seam is missing");
  return {
    html: enhanceRoomShell(source
      .replace(style[0],
        '<link rel="stylesheet" href="/room.css">\n<link rel="stylesheet" href="/room-ui.css">')
      .replace(script[0], '<script src="/room.js"></script>\n</body>')),
    css: `${style[1]}\n`,
    js: `${normalizeRoomScript(script[1])}\n`,
  };
}

await rm(WWW, { recursive: true, force: true });
await cp(SOURCE, WWW, { recursive: true });
await mkdir(path.join(WWW, "static"), { recursive: true });
await cp(path.join(SOURCE, "pcm-worklet.js"), path.join(WWW, "static", "pcm-worklet.js"));
// The runtime asks for interface dictionaries at /static/i18n, the one path
// that resolves the same way under FastAPI, the Worker, and the native shell.
await cp(path.join(SOURCE, "i18n"), path.join(WWW, "static", "i18n"), { recursive: true });

for (const name of ["index.html", "room.html"]) {
  const target = path.join(WWW, name);
  let html = await readFile(target, "utf8");
  const marker = '<script src="/app-runtime.js"></script>';
  if (!html.includes(marker)) throw new Error(`${name} is missing the app runtime seam`);
  html = html.replace(marker, `<script src="/mobile-bridge.js"></script>${marker}`);
  if (name === "room.html") {
    const room = decomposeRoom(html);
    html = room.html;
    await writeFile(path.join(WWW, "room.css"), room.css, "utf8");
    await writeFile(path.join(WWW, "room.js"), room.js, "utf8");
    if (!html.includes(FOUR_PERSON_FALLBACK) && !html.includes(TWO_PERSON_FALLBACK)) {
      throw new Error("room.html is missing the participant-count fallback seam");
    }
    html = html.replace(FOUR_PERSON_FALLBACK, TWO_PERSON_FALLBACK);
  }
  await writeFile(target, html, "utf8");
}

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

if (path.dirname(WWW) !== MOBILE || path.basename(WWW) !== "www") {
  throw new Error(`Refusing unsafe mobile web target: ${WWW}`);
}

function normalizeRoomScript(source) {
  for (const seam of [
    STATUS_STYLE_SEAM, STATUS_TIMEOUT_SEAM, PARTICIPANT_COUNT_SEAM, WELCOME_SEAM,
    AUDIO_ENDED_SEAM, VIDEO_ENDED_SEAM, SOCKET_TEARDOWN_SEAM, CONNECTION_STATE_SEAM,
    CONNECT_SEAM, DISCONNECT_SEAM,
  ]) {
    if (!source.includes(seam)) throw new Error(`room normalization seam is missing: ${seam.slice(0, 32)}`);
  }
  return source
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
    .replace(DISCONNECT_SEAM, DISCONNECT_GUARDED);
}

function enhanceRoomShell(source) {
  return source
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

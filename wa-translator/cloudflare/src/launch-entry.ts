import roomSource from "../../windows/static/room.html";
import mobileEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./mobile-entry";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const HTML_ISOLATION_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'";
const APP_CONTENT_POLICY = `${HTML_ISOLATION_POLICY}; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'`;
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

type RoomAssets = { shell: string; css: string; js: string };

function normalizeRoomScript(source: string): string {
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

function enhanceRoomShell(source: string): string {
  return source
    .replace('<div id="videoNote">', '<div id="videoNote" role="status" aria-live="polite">')
    .replace('<div id="status">', '<div id="status" role="status" aria-live="polite">')
    .replace('<div id="captions">',
      '<div id="captions" role="log" aria-live="polite" aria-relevant="additions text">');
}

function decomposeRoom(source: string): RoomAssets {
  const style = source.match(ROOM_STYLE_PATTERN);
  const script = source.match(ROOM_SCRIPT_PATTERN);
  if (!style || !script) throw new Error("room source decomposition seam is missing");
  const shell = enhanceRoomShell(source
    .replace(style[0],
      '<link rel="stylesheet" href="/room.css">\n<link rel="stylesheet" href="/room-ui.css">')
    .replace(script[0], '<script src="/room.js"></script>\n</body>'));
  return { shell, css: `${style[1]}\n`, js: `${normalizeRoomScript(script[1])}\n` };
}

const canonicalRoom = decomposeRoom(roomSource);

function isRoomPath(pathname: string): boolean {
  return pathname === "/room.html" || pathname.startsWith("/room/");
}

function isRoomShell(html: string): boolean {
  return html.includes('id="roleGate"') && html.includes('id="participantCount"');
}

function roomAsset(pathname: string): Response | null {
  const content = pathname === "/room.css" ? canonicalRoom.css
    : pathname === "/room.js" ? canonicalRoom.js : null;
  if (content === null) return null;
  return new Response(content, {headers: {
    "Cache-Control": "no-store",
    "Content-Type": pathname.endsWith(".css") ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  }});
}

function roomContentPolicy(request: Request): string {
  const url = new URL(request.url);
  const websocketOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  return `${HTML_ISOLATION_POLICY}; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' ${websocketOrigin}; worker-src 'self'`;
}

async function hardenHtml(request: Request, response: Response): Promise<Response> {
  if (response.webSocket) return response;
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return response;

  // Materialize HTML instead of transplanting a fixed-length asset stream into
  // a new Response. Workerd can otherwise retain the original length contract
  // while the wrapper changes headers/body handling and cancel the request.
  const sourceHtml = await response.text();
  const room = isRoomPath(new URL(request.url).pathname) || isRoomShell(sourceHtml);
  const html = room
    ? decomposeRoom(sourceHtml).shell.replace(FOUR_PERSON_FALLBACK, TWO_PERSON_FALLBACK)
    : sourceHtml;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("Content-Security-Policy", room ? roomContentPolicy(request) : APP_CONTENT_POLICY);
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Permissions-Policy", room
    ? "camera=(self), microphone=(self)"
    : "camera=(), microphone=()");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const asset = roomAsset(new URL(request.url).pathname);
    if (asset && request.method === "GET") return asset;
    return hardenHtml(request, await mobileEntry.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;

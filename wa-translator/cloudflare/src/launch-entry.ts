import roomSource from "../../windows/static/room.html";
import mobileEntry, { AbuseGate, Room, UserDirectory } from "./mobile-entry";
import { ReportInbox } from "./report-inbox";
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
const CONTROL_FETCH_SEAMS = ["/api/capabilities", "/api/turn", "/api/room", "/api/reports"] as const;
const NATIVE_AUTH_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NATIVE_AUTH_START_PATTERN = /^\/auth\/native\/(google|apple|facebook)\/start$/;
const MODAL_UPSTREAM_TIMEOUT_MS = 30_000;
const TURN_UPSTREAM_TIMEOUT_MS = 10_000;
const OAUTH_UPSTREAM_TIMEOUT_MS = 20_000;
const ABUSE_IP_PURPOSE = "abuse-ip.v1";
const NATIVE_PREFLIGHT_METHODS = new Map([
  ["/api/v1/mobile/bootstrap", "GET"],
  ["/api/v1/auth/handoff", "POST"],
  ["/api/v1/capabilities", "GET"],
  ["/api/v1/rooms", "POST"],
  ["/api/v1/room", "GET"],
  ["/api/v1/room-control", "GET"],
  ["/api/v1/room-control/close", "POST"],
  ["/api/v1/turn", "GET"],
  ["/api/v1/reports", "POST"],
  ["/api/v1/tts", "POST"],
  ["/api/v1/me", "GET"],
  ["/api/v1/account/delete", "POST"],
  ["/api/v1/auth/logout", "POST"],
]);

type RoomAssets = { shell: string; css: string; js: string };

type FetchSource = { fetch(request: Request): Promise<Response> };

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pseudonymizeEdgeIp(request: Request, env: Env): Promise<Request> {
  const ip = request.headers.get("CF-Connecting-IP");
  const secret = env.ROOM_SIGNING_KEY || "";
  if (!ip || new TextEncoder().encode(secret).byteLength < 32) return request;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      {name: "HMAC", hash: "SHA-256"}, false, ["sign"]
    );
    const digest = await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(`${ABUSE_IP_PURPOSE}\0${ip}`)
    );
    const headers = new Headers(request.headers);
    // The base Worker hashes this value again when naming the short-lived quota
    // Durable Object. Replacing the raw edge IP here keeps bucket stability but
    // makes that stored identity impossible to dictionary-test without the key.
    headers.set("CF-Connecting-IP", `p1.${base64url(digest)}`);
    return new Request(request, {headers});
  } catch {
    // Quotas already hash the edge-owned value in the base Worker. A local
    // crypto failure must not disable abuse controls or fail the user request.
    return request;
  }
}

function boundedFetcher(source: FetchSource | undefined, timeoutMs: number): Fetcher {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init);
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(timeoutMs),
      ]);
      const bounded = new Request(request, {signal});
      try {
        return source ? await source.fetch(bounded) : await fetch(bounded);
      } catch {
        // The base Worker already maps non-success upstream responses to the
        // endpoint-specific fail-closed result (TURN/TTS unavailable or OAuth
        // failure). Return a response instead of leaking an abort as a generic
        // unhandled 500 from the outer Worker boundary.
        return new Response("Upstream unavailable", {
          status: 504,
          headers: {"Cache-Control": "no-store"},
        });
      }
    },
  } as unknown as Fetcher;
}

function boundedUpstreamEnv(env: Env): Env {
  return {
    ...env,
    MODAL_TEST: boundedFetcher(env.MODAL_TEST, MODAL_UPSTREAM_TIMEOUT_MS),
    TURN_TEST: boundedFetcher(env.TURN_TEST, TURN_UPSTREAM_TIMEOUT_MS),
    OAUTH_TEST: boundedFetcher(env.OAUTH_TEST, OAUTH_UPSTREAM_TIMEOUT_MS),
  };
}

function normalizeRoomScript(source: string): string {
  for (const seam of [
    STATUS_STYLE_SEAM, STATUS_TIMEOUT_SEAM, PARTICIPANT_COUNT_SEAM, WELCOME_SEAM,
    AUDIO_ENDED_SEAM, VIDEO_ENDED_SEAM, SOCKET_TEARDOWN_SEAM, CONNECTION_STATE_SEAM,
    CONNECT_SEAM, DISCONNECT_SEAM, CALL_GATE_SEAM, CALL_GATE_BUTTON_SEAM,
    CALL_WAIT_SEAM, CALL_RINGBACK_SEAM, WELCOME_CALL_SEAM, PEER_JOIN_CALL_SEAM,
    TERMS_KEY_SEAM, TERMS_BINDING_SEAM, ROOM_FETCH_HELPER_SEAM,
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
    .replace(ROOM_FETCH_HELPER_SEAM, ROOM_FETCH_HELPER_CURRENT);
  for (const path of CONTROL_FETCH_SEAMS) {
    normalized = normalized.replace(`fetch(runtime.apiUrl('${path}')`, `roomFetch(runtime.apiUrl('${path}')`);
  }
  return normalized;
}

function enhanceRoomShell(source: string): string {
  if (!source.includes(TERMS_CHECKBOX_SEAM)) {
    throw new Error("room shell is missing the explicit Terms-consent seam");
  }
  return source
    .replace(TERMS_CHECKBOX_SEAM, TERMS_CHECKBOX_EXPLICIT)
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

function isPrivateDynamicPath(pathname: string): boolean {
  return pathname === "/tts"
    || pathname.startsWith("/api/")
    || pathname.startsWith("/auth/")
    || pathname.startsWith("/room/")
    || pathname.startsWith("/ws/");
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

function nativeAuthChallengeStart(request: Request, env: Env): Response | null {
  const url = new URL(request.url);
  const match = url.pathname.match(NATIVE_AUTH_START_PATTERN);
  if (!match) return null;

  // Older installed builds sent the raw binding as `binding=`. Preserve that
  // path through mobileEntry during the migration; current clients send only a
  // one-way SHA-256 challenge and are handled here before the legacy route.
  const entries = [...url.searchParams.entries()];
  if (entries.length === 1 && entries[0][0] === "binding") return null;
  if (request.method !== "GET") return new Response("Method Not Allowed", {status: 405});
  if (!env.PUBLIC_ORIGIN) return new Response("Sign-in is not configured", {status: 503});
  const challenge = entries.length === 1 && entries[0][0] === "challenge" ? entries[0][1] : "";
  if (!NATIVE_AUTH_CHALLENGE_PATTERN.test(challenge)) {
    return new Response("Invalid native authentication challenge", {status: 400});
  }

  const headers = new Headers();
  headers.set("Location", `${env.PUBLIC_ORIGIN}/auth/${match[1]}/start`);
  headers.append("Set-Cookie",
    `lr_native_oauth=${match[1]}.${challenge}; HttpOnly; Secure; SameSite=None; Path=/auth; Max-Age=600`);
  return new Response(null, {status: 302, headers});
}

function roomContentPolicy(request: Request): string {
  const url = new URL(request.url);
  const websocketOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  return `${HTML_ISOLATION_POLICY}; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' ${websocketOrigin}; worker-src 'self'`;
}

async function hardenResponse(request: Request, response: Response): Promise<Response> {
  if (response.webSocket) return response;
  const headers = new Headers(response.headers);
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  if (isPrivateDynamicPath(new URL(request.url).pathname)) {
    headers.set("Cache-Control", "no-store");
  }

  const contentType = headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // Materialize HTML instead of transplanting a fixed-length asset stream into
  // a new Response. Workerd can otherwise retain the original length contract
  // while the wrapper changes headers/body handling and cancel the request.
  const sourceHtml = await response.text();
  const room = isRoomPath(new URL(request.url).pathname) || isRoomShell(sourceHtml);
  const html = room
    ? decomposeRoom(sourceHtml).shell.replace(FOUR_PERSON_FALLBACK, TWO_PERSON_FALLBACK)
    : sourceHtml;

  headers.delete("Content-Length");
  headers.set("Content-Security-Policy", room ? roomContentPolicy(request) : APP_CONTENT_POLICY);
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", room
    ? "camera=(self), microphone=(self)"
    : "camera=(), microphone=()");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function nativePreflight(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "OPTIONS" || !url.pathname.startsWith("/api/v1/")) return null;
  const allowed = NATIVE_PREFLIGHT_METHODS.get(url.pathname);
  if (!allowed) return new Response("Not Found", {status: 404});
  const requested = (request.headers.get("Access-Control-Request-Method") || "").toUpperCase();
  if (requested !== allowed) return new Response("Method Not Allowed", {status: 405});

  const response = await mobileEntry.fetch(request, env, ctx);
  if (response.status !== 204) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Methods", `${allowed}, OPTIONS`);
  return new Response(null, {status: 204, headers});
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const asset = roomAsset(url.pathname);
    if (asset && request.method === "GET") return asset;
    const challengeStart = nativeAuthChallengeStart(request, env);
    if (challengeStart) return hardenResponse(request, challengeStart);

    const boundedEnv = boundedUpstreamEnv(env);
    const routedRequest = await pseudonymizeEdgeIp(request, boundedEnv);
    const preflight = await nativePreflight(routedRequest, boundedEnv, ctx);
    if (preflight) return hardenResponse(request, preflight);
    return hardenResponse(request, await mobileEntry.fetch(routedRequest, boundedEnv, ctx));
  },
} satisfies ExportedHandler<Env>;
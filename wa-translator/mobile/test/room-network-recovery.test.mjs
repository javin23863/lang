import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);
const browserRuntime = new URL("../../windows/static/app-runtime.js", import.meta.url);
const browserBootstrap = new URL("../../windows/static/qr.js", import.meta.url);
const qrEncoder = new URL("../../windows/static/qr-encoder.js", import.meta.url);

test("prepared room has bounded reconnect and foreground recovery behavior", async () => {
  const source = await readFile(new URL("room.js", root), "utf8");

  assert.match(source, /const ROOM_CONTROL_FETCH_TIMEOUT_MS = 12000/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), ROOM_CONTROL_FETCH_TIMEOUT_MS\)/);
  assert.match(source, /let connectGeneration = 0/);
  assert.match(source, /if \(ws && ws\.readyState < WebSocket\.CLOSING\) return/,
    "parallel connect attempts are coalesced");
  assert.match(source, /const generation = \+\+connectGeneration/);
  assert.match(source, /if \(leaving \|\| generation !== connectGeneration\) return/);
  assert.match(source, /connectGeneration\+\+;/,
    "disconnect invalidates in-flight async connect work");

  assert.match(source, /setStatus\('status\.reconnecting', null, true\)/);
  assert.match(source, /Math\.min\(8000, 250 \* 2 \*\* Math\.min\(reconnectFailures, 5\)\)/,
    "socket reconnect backoff is bounded");
  assert.match(source, /setTimeout\(connect, delay\)/);
  assert.match(source, /window\.addEventListener\('pagehide', suspendRoom\)/);
  assert.match(source, /window\.addEventListener\('pageshow', restoreSuspendedRoom\)/);
  assert.match(source, /window\.addEventListener\('lingua-app-state'/);
  assert.match(source, /setStatus\('status\.backgroundPaused', null, true\)/);
  assert.match(source, /setStatus\('status\.rejoining', null, true\)/);

  for (const terminal of [
    "status.roomExpired", "status.roomClosed", "status.roomFull", "gate.updateRequired",
  ]) assert.ok(source.includes(`'${terminal}'`), `room exposes terminal state ${terminal}`);
  for (const degraded of ["note.reconnectingPeer", "note.videoFailed", "note.videoSlow"]) {
    assert.ok(source.includes(`'${degraded}'`), `room exposes degraded state ${degraded}`);
  }
});

test("prepared room bounds ICE failure recovery without consuming TURN quota per failure", async () => {
  const source = await readFile(new URL("room.js", root), "utf8");

  assert.match(source, /const ICE_RESTART_WINDOW_MS = 60 \* 1000/);
  assert.match(source, /const ICE_RESTART_MAX_PER_WINDOW = 3/);
  assert.match(source, /function restartFailedIce\(state\) \{/);
  assert.match(source,
    /if \(leaving \|\| terminalRoom \|\| !ws \|\| ws\.readyState !== WebSocket\.OPEN\) return false/,
    "ICE restart requires live signalling");
  assert.match(source,
    /state\.iceRestartAttempts = \(state\.iceRestartAttempts \|\| \[\]\)\s+\.filter\(attemptedAt => now - attemptedAt < ICE_RESTART_WINDOW_MS\)/,
    "ICE restart attempts use a rolling window");
  assert.match(source,
    /if \(state\.iceRestartAttempts\.length >= ICE_RESTART_MAX_PER_WINDOW\) return false/,
    "ICE restart is bounded per peer");
  assert.match(source, /state\.pc\.restartIce\(\)/);
  assert.match(source,
    /if \(pc\.iceConnectionState === 'failed'\) \{\s+restartFailedIce\(state\);/,
    "failed ICE immediately invokes bounded recovery");
  assert.doesNotMatch(source,
    /pc\.oniceconnectionstatechange[\s\S]{0,260}refreshIceServers/,
    "an ICE failure must not spend a TURN credential request");

  assert.match(source, /response\.status === 429/);
  assert.match(source, /response\.headers\.get\('Retry-After'\)/);
  assert.match(source, /scheduleTurnRefresh\(Math\.max\(30000, retryAfterMs\)\)/,
    "TURN rate limiting respects the server retry window");
});

test("browser and PWA rooms have bounded ICE recovery and TURN retry floors", async () => {
  const source = await readFile(browserRuntime, "utf8");

  assert.match(source, /const BROWSER_ICE_RESTART_WINDOW_MS = 60 \* 1000/);
  assert.match(source, /const BROWSER_ICE_RESTART_MAX_PER_WINDOW = 3/);
  assert.match(source, /function installBrowserRoomNetworkRecovery\(\) \{/);
  assert.ok(
    source.includes('if (native || !/^\\/room\\/[^/]+$/.test(location.pathname)')
      && source.includes('|| typeof window.fetch !== "function") return;'),
    "recovery is limited to browser/PWA room routes and does not double-install in native",
  );
  assert.match(source, /window\.WebSocket = TrackingWebSocket/,
    "browser room signalling is tracked without changing the room protocol");
  assert.match(source, /window\.RTCPeerConnection = RecoveringRTCPeerConnection/);
  assert.match(source, /const restartAttempts = new WeakMap\(\)/);
  assert.match(source,
    /!roomSocket \|\| roomSocket\.readyState !== NativeWebSocket\.OPEN/,
    "ICE restart requires a live room signalling socket");
  assert.match(source,
    /\.filter\(attemptedAt => now - attemptedAt < BROWSER_ICE_RESTART_WINDOW_MS\)/,
    "browser ICE restart attempts use a rolling window");
  assert.match(source,
    /attempts\.length >= BROWSER_ICE_RESTART_MAX_PER_WINDOW/,
    "browser ICE restart is bounded per peer");
  assert.match(source, /pc\.restartIce\(\)/,
    "failed browser ICE immediately requests renegotiation");

  const iceHandler = source.slice(
    source.indexOf('pc.addEventListener("iceconnectionstatechange"'),
    source.indexOf("return pc;", source.indexOf('pc.addEventListener("iceconnectionstatechange"')),
  );
  assert.doesNotMatch(iceHandler, /fetch|scheduleTurnRefresh|\/api\/turn/,
    "a browser ICE failure must not consume a TURN credential request");

  assert.match(source, /url\.pathname !== "\/api\/turn"/);
  assert.match(source, /response\.status === 429/);
  assert.match(source, /response\.headers\.get\("Retry-After"\)/);
  assert.match(source,
    /turnRetryNotBefore = Date\.now\(\) \+ Math\.max\(30000, retryAfterMs\)/);
  assert.match(source,
    /original\(Math\.max\(Number\(delay\) \|\| 0, retryFloor\)\)/,
    "browser TURN retries cannot run before the server retry window");
});

test("browser/PWA room control fetches are bounded before normal join and reconnect work", async () => {
  const source = await readFile(browserBootstrap, "utf8");
  const encoder = await readFile(qrEncoder, "utf8");

  assert.match(source, /const ROOM_CONTROL_FETCH_TIMEOUT_MS = 12000/);
  for (const path of ["/api/capabilities", "/api/turn", "/api/room", "/api/reports"]) {
    assert.ok(source.includes(`"${path}"`), `browser control deadline covers ${path}`);
  }
  assert.match(source, /if \(!native && roomRoute && typeof window\.fetch === "function"\)/,
    "native keeps its stronger generated roomFetch path");
  assert.match(source, /const boundedFetch = window\.fetch\.bind\(window\)/,
    "the timeout composes with app-runtime TURN Retry-After handling");
  assert.match(source, /url\.origin !== location\.origin \|\| !ROOM_CONTROL_PATHS\.has\(url\.pathname\)/,
    "only same-origin room control APIs receive the browser deadline");
  assert.match(source, /const callerSignal = init\.signal/);
  assert.match(source, /input instanceof Request \? input\.signal : null/,
    "Request-level caller aborts are retained");
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /callerSignal\?\.addEventListener\("abort", abortFromCaller, \{once: true\}\)/);
  assert.match(source,
    /timer = setTimeout\(\(\) => \{\s*controller\.abort\(\);\s*release\(\);\s*\}, ROOM_CONTROL_FETCH_TIMEOUT_MS\)/,
    "the browser deadline aborts network work and releases body-read lifecycle ownership");
  assert.match(source, /boundedFetch\(input, \{\.\.\.init, signal: controller\.signal\}\)/);
  assert.match(source, /clearTimeout\(timer\)/);
  assert.match(source, /callerSignal\?\.removeEventListener\("abort", abortFromCaller\)/);
  assert.match(source, /qrCore\.src = "\/qr-encoder\.js"/,
    "existing room/dashboard markup can keep loading /qr.js");
  assert.match(encoder, /window\.LinguaQR = \{svg: svg, _matrix: matrix\}/,
    "the original QR encoder remains available behind the bootstrap");
});

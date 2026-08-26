import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

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

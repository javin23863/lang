import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("room asks for media only from explicit feature actions and recovers cleanly", async () => {
  const source = await readFile(new URL("room.js", root), "utf8");

  const startPeer = source.match(/function startPeer\(peer\) \{([\s\S]*?)\n\}\n\nasync function onSignal/)?.[1] || "";
  assert.ok(startPeer, "prepared room contains startPeer");
  assert.doesNotMatch(startPeer, /getAudioMedia\(|getVideoMedia\(|getUserMedia\(/,
    "joining/peer negotiation never prompts for camera or microphone");

  assert.match(source, /function getAudioMedia\(\) \{[\s\S]*?navigator\.mediaDevices\.getUserMedia\(\{[\s\S]*?video: false/);
  assert.match(source, /function getVideoMedia\(\) \{[\s\S]*?navigator\.mediaDevices\.getUserMedia\(\{[\s\S]*?audio: false/);
  assert.match(source, /\$\('micBtn'\)\.onclick = async \(\) => \{[\s\S]*?await startCapture\(\)[\s\S]*?setStatus\('status\.micUnavailable', null, true\)/);
  assert.match(source, /\$\('camBtn'\)\.onclick = async \(\) => \{[\s\S]*?await getVideoMedia\(\)[\s\S]*?setStatus\('status\.cameraUnavailable', null, true\)/);

  // The shipping normalization adds recovery notices when an already-granted
  // track is revoked or ends while the room remains open.
  assert.match(source, /track\.onended = \(\) => \{[\s\S]*?setStatus\('status\.micUnavailable', null, true\)/);
  assert.match(source, /track\.onended = \(\) => \{[\s\S]*?setStatus\('status\.cameraUnavailable', null, true\)/);

  const beforeHandlers = source.slice(0, source.indexOf("$('micBtn').onclick"));
  assert.doesNotMatch(beforeHandlers, /startCapture\(\);/,
    "cold room initialization does not start microphone capture");
});

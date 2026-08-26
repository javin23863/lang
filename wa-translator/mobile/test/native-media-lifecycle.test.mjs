import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("native background teardown cannot leave stale camera-on chrome", async () => {
  const [entry, lifecycle] = await Promise.all([
    read("../src/mobile-entry.ts"),
    read("../src/native-media-lifecycle.ts"),
  ]);

  assert.match(entry,
    /import "\.\/mobile-bridge";\s*import "\.\/native-back";\s*import "\.\/native-media-lifecycle";/,
    "native media lifecycle handling must ship in the established bridge bundle");
  assert.match(lifecycle, /Capacitor\.isNativePlatform\(\)/,
    "browser room behavior is not intercepted by the native bridge helper");
  assert.match(lifecycle,
    /window\.addEventListener\("lingua-app-state",[\s\S]*?\{capture: true\}\)/,
    "native teardown runs in capture phase before the room's normal background listener");
  assert.match(lifecycle, /state\.detail\?\.isActive !== false/,
    "foreground events must not reset live media");
  assert.match(lifecycle,
    /#camBtn[\s\S]*?!camera\.classList\.contains\("off"\)[\s\S]*?camera\.click\(\)/,
    "an active camera is turned off through the room's existing state owner");
  assert.match(lifecycle, /\["#selfVideo", "#remoteVideo"\]/);
  assert.match(lifecycle, /video\.srcObject = null/,
    "stopped media cannot leave a stale self or remote frame in the native WebView");
});

test("late native media acquisition is stopped instead of resurrecting capture after teardown", async () => {
  const lifecycle = await read("../src/native-media-lifecycle.ts");

  assert.match(lifecycle, /let mediaGeneration = 0/);
  assert.match(lifecycle,
    /const originalGetUserMedia = mediaDevices\.getUserMedia\.bind\(mediaDevices\)/,
    "the guard delegates normal foreground capture to the platform implementation");
  assert.match(lifecycle,
    /const generation = mediaGeneration;[\s\S]*?await originalGetUserMedia\(constraints\)[\s\S]*?generation !== mediaGeneration/,
    "each permission request is bound to the room lifecycle generation that started it");
  assert.match(lifecycle,
    /generation !== mediaGeneration[\s\S]*?stopCapturedStream\(stream\)[\s\S]*?new DOMException\([^)]*"AbortError"\)/,
    "a request resolving after teardown stops every captured track and fails the old continuation");
  assert.match(lifecycle,
    /for \(const track of stream\.getTracks\(\)\)[\s\S]*?track\.stop\(\)/,
    "late audio and video tracks are both physically stopped");
  assert.match(lifecycle,
    /document\.addEventListener\("click", invalidateEndingRoomClick, \{capture: true\}\)/);
  assert.match(lifecycle, /closest\("#leaveBtn, #reportBtn"\)/,
    "Leave/End Call and report-and-leave invalidate pending permission requests before room teardown");
  assert.match(lifecycle,
    /window\.addEventListener\("pagehide", invalidatePendingMedia, \{capture: true\}\)/,
    "navigation/BFCache teardown also invalidates pending native media");
  assert.match(lifecycle,
    /invalidatePendingMedia\(\);\s*resetRoomMediaChrome\(\);/,
    "background invalidation runs before the existing camera/video reset");
});

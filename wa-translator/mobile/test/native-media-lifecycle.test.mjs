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

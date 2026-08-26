import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Android system Back preserves room cleanup and normal navigation", async () => {
  const [pkgSource, entry, back, bridge] = await Promise.all([
    read("../package.json"),
    read("../src/mobile-entry.ts"),
    read("../src/native-back.ts"),
    read("../src/mobile-bridge.ts"),
  ]);
  const pkg = JSON.parse(pkgSource);

  assert.match(pkg.scripts["build:bridge"], /^esbuild src\/mobile-entry\.ts\b/,
               "the native navigation listener must ship in the same bridge bundle");
  assert.match(entry, /import "\.\/mobile-bridge";\s*import "\.\/native-back";/,
               "the established bridge initializes before Android navigation handling");

  assert.match(back, /Capacitor\.getPlatform\(\) === "android"/,
               "hardware Back interception is Android-only");
  assert.match(back, /App\.addListener\("backButton", \(\{canGoBack\}\) =>/);
  assert.match(back,
    /clickIfVisible\("#qrBtn", "#qrBox"\)[\s\S]*?clickIfVisible\("#menuBtn", "#roomMenu"\)[\s\S]*?#leaveBtn[\s\S]*?leave\.click\(\)/,
    "Back dismisses transient room UI before it can end the conversation");
  assert.match(back, /if \(handleRoomBack\(\)\) return;[\s\S]*?if \(canGoBack\)[\s\S]*?window\.history\.back\(\)[\s\S]*?App\.exitApp\(\)/,
               "non-room Back keeps WebView history and exits only at the app root");

  assert.match(bridge, /function returnHomeAfterNativeLeave/);
  assert.match(bridge, /document\.addEventListener\("click", returnHomeAfterNativeLeave\)/,
               "hardware Back reuses the existing post-Leave native-home transition");
});

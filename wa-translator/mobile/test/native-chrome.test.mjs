import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("native launch chrome matches the dashboard and room surfaces", async () => {
  const config = await read("../capacitor.config.ts");
  const bridge = await read("../src/mobile-bridge.ts");
  const plist = await read("../ios/App/App/Info.plist");

  assert.match(config, /backgroundColor:\s*"#F4FBF9"/,
               "the native splash matches the generated cream launch art");
  assert.match(config, /StatusBar:[\s\S]*?style:\s*"LIGHT"/,
               "the light dashboard starts with dark status-bar foreground content");
  assert.doesNotMatch(config, /StatusBar:[\s\S]*?backgroundColor:/,
                      "API 36 does not rely on an ineffective status-bar background color");

  assert.match(bridge, /import \{ StatusBar, Style \} from "@capacitor\/status-bar"/);
  assert.match(bridge, /roomPage \? Style\.Dark : Style\.Light/,
               "the always-dark call room uses light status-bar foreground content");
  assert.match(bridge, /if \(state\.isActive\) void applyNativeChrome\(\)/,
               "returning from system UI reapplies the current page chrome");

  assert.match(plist,
    /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<true\/>/,
    "iOS allows Capacitor to update status-bar appearance per view controller");
});

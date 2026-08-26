import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("native launch chrome matches dashboard, room, and legal surfaces", async () => {
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
  assert.match(bridge,
    /LOCAL_DARK_CONTENT = new Set\(\[\s*"privacy\.html", "terms\.html", "support\.html", "delete-account\.html"\s*\]\)/,
    "every standalone dark legal/deletion page is known before native navigation");
  assert.match(bridge, /LOCAL_DARK_CONTENT\.has\(page\)[\s\S]*?Style\.Dark/,
               "dashboard-to-legal navigation switches foreground contrast before leaving");
  assert.match(bridge,
    /document\.addEventListener\("click", prepareLocalContentChrome, \{capture: true\}\)/,
    "the chrome transition observes local legal links before navigation");
  assert.match(bridge, /if \(state\.isActive\) void applyNativeChrome\(\)/,
               "returning from system UI reapplies the current page chrome");

  assert.match(bridge,
    /function returnHomeAfterNativeLeave\(event: MouseEvent\): void \{[\s\S]*?room\\\.html[\s\S]*?closest\("#leaveBtn"\)[\s\S]*?setTimeout\([\s\S]*?window\.location\.replace\("index\.html"\)/,
    "explicit native Leave and voice End Call return to the app home after room cleanup");
  assert.match(bridge, /document\.addEventListener\("click", returnHomeAfterNativeLeave\)/,
    "native room exit is installed as a post-room-handler click listener");
  assert.match(bridge, /callEnd` delegates through leaveBtn\.click\(\), while report\/block invokes[\s\S]*?leaveRoom\(\) directly/,
    "the native redirect intentionally excludes programmatic report/block cleanup");

  // Native secure storage is cleared only after the server confirms logout or
  // account deletion. A 503 from the revocation write therefore leaves the
  // bearer available for retry instead of reporting a false successful logout.
  assert.match(bridge,
    /let clearSession = response\.ok && request\.method === "POST"[\s\S]*?\/api\/v1\/auth\/logout[\s\S]*?\/api\/v1\/account\/delete/,
    "logout/delete local clearing is conditioned on a successful server response");
  assert.match(bridge, /if \(!clearSession && attachedNativeSession && response\.status === 401\)/,
               "an explicitly rejected stale bearer self-clears from secure storage");
  assert.match(bridge,
    /request\.method === "GET" && url\.pathname === "\/api\/v1\/me"[\s\S]*?account\.signed_in === false[\s\S]*?clearSession = true/,
    "a revoked session represented as a signed-out account snapshot also self-clears");
  assert.match(bridge, /if \(clearSession\) await clearNativeSession\(\)/);

  assert.match(plist,
    /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<true\/>/,
    "iOS allows Capacitor to update status-bar appearance per view controller");
});

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared mobile web bundle contains the app, runtime, legal pages, and local worklet", async () => {
  for (const path of [
    "index.html", "room.html", "room.css", "room-ui.css", "room.js",
    "app-runtime.js", "mobile-bridge.js", "qr.js",
    "dashboard.css", "dashboard.js", "privacy.html", "terms.html", "support.html",
    "delete-account.html", "legal-runtime.js", "third-party-notices.txt", "static/pcm-worklet.js"
  ]) await access(new URL(path, root));

  for (const name of ["index.html", "room.html"]) {
    const html = await readFile(new URL(name, root), "utf8");
    const bridge = html.indexOf('<script src="/mobile-bridge.js"></script>');
    const runtime = html.indexOf('<script src="/app-runtime.js"></script>');
    assert.ok(bridge >= 0 && runtime > bridge, `${name} loads native bridge before runtime`);
    assert.doesNotMatch(html, /server\.url|window\.location\s*=\s*["']https:\/\//);
  }
  const dashboard = await readFile(new URL("index.html", root), "utf8");
  assert.match(dashboard, /<link rel="stylesheet" href="\/dashboard\.css">/);
  assert.match(dashboard, /<script src="\/dashboard\.js"><\/script>/);

  for (const name of ["privacy.html", "terms.html", "support.html", "delete-account.html"]) {
    const html = await readFile(new URL(name, root), "utf8");
    assert.match(html, /id="legalBack"/);
    assert.match(html, /<script src="legal-runtime\.js"><\/script>/,
                 `${name} keeps safe return-navigation behavior in the native bundle`);
  }
});

test("prepared mobile bundle carries production third-party legal material", async () => {
  const notices = await readFile(new URL("third-party-notices.txt", root), "utf8");
  assert.match(notices, /Lingua Relay third-party notices/);
  assert.match(notices, /@capacitor\/core@8\.5\.0/);
  assert.match(notices, /@aparajita\/capacitor-secure-storage@8\.0\.0/);
  assert.match(notices, /Apache License/);
  assert.match(notices, /MIT License/);
  assert.doesNotMatch(notices, /@capacitor\/cli@8\.5\.0/,
                      "development-only Capacitor CLI is not redistributed in the app notice");
  assert.doesNotMatch(notices, /typescript@7\.0\.2/,
                      "development-only TypeScript is not redistributed in the app notice");
});

test("phone video status reserves the local preview area", async () => {
  const css = await readFile(new URL("room.css", root), "utf8");
  assert.match(css, /#videoNote\{[^}]*padding-inline-end:calc\(min\(27vw,130px\) \+ 30px\)/);
  assert.match(css, /html\[dir=rtl\] #selfWrap\{left:10px;right:auto\}/);
});

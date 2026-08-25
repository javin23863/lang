import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared mobile web bundle contains the app, runtime, legal pages, and local worklet", async () => {
  for (const path of [
    "index.html", "room.html", "room.css", "room-ui.css", "room.js",
    "app-runtime.js", "mobile-bridge.js", "qr.js",
    "dashboard.css", "dashboard.js", "privacy.html", "terms.html", "support.html",
    "delete-account.html", "legal-runtime.js", "static/pcm-worklet.js"
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

test("phone video status reserves the local preview area", async () => {
  const css = await readFile(new URL("room.css", root), "utf8");
  assert.match(css, /#videoNote\{[^}]*padding-inline-end:calc\(min\(27vw,130px\) \+ 30px\)/);
  assert.match(css, /html\[dir=rtl\] #selfWrap\{left:10px;right:auto\}/);
});

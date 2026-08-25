import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared mobile surfaces preserve accessibility and responsive contracts", async () => {
  const [dashboardHtml, dashboardCss, tokens, roomHtml, roomCss] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("dashboard.css", root), "utf8"),
    readFile(new URL("design-tokens.css", root), "utf8"),
    readFile(new URL("room.html", root), "utf8"),
    readFile(new URL("room.css", root), "utf8"),
  ]);

  assert.match(dashboardHtml, /<main class="page" aria-label="Lingua Relay">/);
  assert.match(dashboardHtml, /id="roomNotice"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(dashboardHtml, /id="authStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(dashboardHtml, /id="onboardingPanel"[^>]*aria-labelledby="onboardingTitle"/);
  assert.match(dashboardHtml, /<nav class="legal card" aria-label="Legal and support">/);
  assert.match(dashboardHtml, /id="createBtn"[^>]*type="button"/);
  assert.match(dashboardHtml, /id="closeBtn"[^>]*type="button"/);

  assert.match(tokens, /--touch-target:48px/);
  assert.match(tokens, /--focus-ring:/);
  assert.match(dashboardCss, /min-height:var\(--touch-target\)/);
  assert.match(dashboardCss, /env\(safe-area-inset-top\)/);
  assert.match(dashboardCss, /env\(safe-area-inset-bottom\)/);
  assert.match(dashboardCss, /@media\(max-width:380px\)/);
  assert.match(dashboardCss, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(dashboardCss, /button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible/);

  assert.match(roomHtml, /id="videoNote" role="status" aria-live="polite"/);
  assert.match(roomHtml, /id="status" role="status" aria-live="polite"/);
  assert.match(roomHtml, /id="captions" role="log" aria-live="polite" aria-relevant="additions text"/);
  assert.match(roomHtml, /id="termsAgree" type="checkbox"/);
  assert.match(roomHtml, /id="reportBtn"[^>]*type="button"/);
  assert.match(roomCss, /button:focus-visible,select:focus-visible,input:focus-visible/);
  assert.match(roomCss, /min-height:44px/);
  assert.match(roomCss, /env\(safe-area-inset-bottom\)/);
  assert.match(roomCss, /html\[dir=rtl\]/);
  assert.match(roomCss, /@media\(max-width:380px\)/);
});

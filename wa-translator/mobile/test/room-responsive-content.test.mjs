import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("room presentation tolerates long localized content, RTL, phones, and landscape", async () => {
  const [css, ui] = await Promise.all([
    readFile(new URL("room.css", root), "utf8"),
    readFile(new URL("room-ui.css", root), "utf8"),
  ]);

  assert.match(css, /\.msg\{[^}]*max-width:82%[^}]*word-wrap:break-word/);
  assert.match(css, /\.shareApp\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /#callName\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /html\[dir=rtl\] #selfWrap/);
  assert.match(css, /html\[dir=rtl\] #participantCount/);
  assert.match(css, /html\[dir=rtl\] \.msg\.mine/);
  assert.match(css, /@media\(max-width:380px\)/);

  assert.match(ui, /padding-inline:max\(clamp\(12px,3vw,28px\),env\(safe-area-inset-left\)\)/);
  assert.match(ui, /@media\(orientation:landscape\) and \(max-height:560px\)/);
  assert.match(ui, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(ui, /animation-duration:\.001ms!important/);
  assert.match(ui, /\.callControls\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(ui, /#callEnd\{[\s\S]*?width:100%/);
});

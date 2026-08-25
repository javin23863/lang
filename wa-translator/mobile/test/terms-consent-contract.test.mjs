import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared room requires affirmative consent to the current Terms version", async () => {
  const html = await readFile(new URL("room.html", root), "utf8");
  const script = await readFile(new URL("room.js", root), "utf8");

  assert.match(html, /<input id="termsAgree" type="checkbox">/,
               "first-time room entry renders an unchecked Terms box");
  assert.doesNotMatch(html, /<input id="termsAgree" type="checkbox" checked>/,
                      "the shipping room may not pre-agree to Terms");
  assert.match(script, /const termsKey = 'lingua-relay\.terms\.2026-08-25';/,
               "only the current Terms version can be remembered");
  assert.match(script, /\$\('termsAgree'\)\.checked = localStorage\.getItem\(termsKey\) === '1';/,
               "only prior acceptance of that exact version restores consent");
  assert.match(script, /if \(roleChosen \|\| !termsAccepted\(\)/,
               "joining remains impossible while consent is absent");
  assert.match(script, /localStorage\.setItem\(termsKey, '1'\)/,
               "acceptance is persisted only through the gated join path");
  assert.doesNotMatch(script, /lingua-relay\.terms\.2026-08-14/,
                      "the previous Terms version cannot carry forward into the shipping bundle");
});

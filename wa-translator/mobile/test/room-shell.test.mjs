import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("native room shell is decomposed, accessible, bridge-enabled and two-person", async () => {
  const html = await read("../www/room.html");
  const css = await read("../www/room.css");
  const uiCss = await read("../www/room-ui.css");
  const js = await read("../www/room.js");

  assert.match(html, /<script src="\/mobile-bridge\.js"><\/script><script src="\/app-runtime\.js"><\/script>/,
               "the native bridge loads before the shared runtime");
  assert.match(html, /<link rel="stylesheet" href="\/room\.css">/,
               "canonical room styling ships as its own asset");
  assert.match(html, /<link rel="stylesheet" href="\/room-ui\.css">/,
               "Lingua room presentation ships after the canonical styling");
  assert.match(html, /<script src="\/room\.js"><\/script>/,
               "room behavior ships as its own asset at the original execution point");
  assert.doesNotMatch(html, /<style>/, "the installed room has no inline style block");
  assert.doesNotMatch(html, /<script>\s*const \$ =/,
                      "the installed room has no inline call implementation");
  assert.match(html, /id="status" role="status" aria-live="polite"/);
  assert.match(html, /id="videoNote" role="status" aria-live="polite"/);
  assert.match(html, /id="captions" role="log" aria-live="polite" aria-relevant="additions text"/);
  assert.match(css, /#stage\{/);
  assert.match(css, /#chatBar\{/);
  assert.match(uiCss, /--accent:#64D4C3/,
               "room presentation uses the Lingua Relay brand accent");
  assert.match(uiCss, /prefers-reduced-motion:reduce/,
               "motion-sensitive users get a non-animated room surface");
  assert.match(uiCss, /orientation:landscape/,
               "compact landscape call layouts are explicitly supported");
  assert.match(js, /const \$ = \(id\) => document\.getElementById\(id\);/);
  assert.match(js, /async function connect\(\)/);
  assert.match(js, /el\.hidden = !text/);
  assert.doesNotMatch(js, /el\.style\.display/,
                      "strict style-src remains compatible with room status updates");
  assert.match(js, /serverCount <= 2/,
               "participant rendering accepts only the two-person server range");
  assert.doesNotMatch(js, /serverCount <= 4/,
                      "the installed client cannot reintroduce the retired four-person range");
  assert.match(js, /m\.participant_limit !== 2/,
               "the installed client fails closed on a mismatched server room contract");
  assert.match(js, /m\.peers\.length > 1/,
               "a welcome payload cannot smuggle multiple remote peers into a two-person room");

  assert.match(html, /id="participantCount" aria-live="polite">0 \/ 2 people</,
               "the first rendered room shell matches the two-person contract");
  assert.doesNotMatch(html, /id="participantCount" aria-live="polite">0 \/ 4 people</,
                      "the installed app never flashes the retired four-person fallback");
});

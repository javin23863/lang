import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("native room shell is bridge-enabled and structurally two-person", async () => {
  const html = await read("../www/room.html");
  assert.match(html, /<script src="\/mobile-bridge\.js"><\/script><script src="\/app-runtime\.js"><\/script>/,
               "the native bridge loads before the shared runtime");
  assert.match(html, /id="participantCount" aria-live="polite">0 \/ 2 people</,
               "the first rendered room shell matches the two-person contract");
  assert.doesNotMatch(html, /id="participantCount" aria-live="polite">0 \/ 4 people</,
                      "the installed app never flashes the retired four-person fallback");
});

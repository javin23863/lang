import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../windows/static/", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("public legal pages share current Lingua chrome and deletion remains discoverable", async () => {
  const css = await read("legal.css");
  assert.match(css, /--canvas:#07110F/);
  assert.match(css, /--accent:#64D4C3/);
  assert.doesNotMatch(css, /#09141e/i, "retired launch palette is not used by legal surfaces");

  for (const page of ["privacy.html", "terms.html", "support.html"]) {
    const html = await read(page);
    assert.match(html, /<meta name="theme-color" content="#07110F">/,
                 `${page} matches the shared dark native/browser chrome`);
    assert.match(html, /Lingua Relay/);
  }

  const privacy = await read("privacy.html");
  assert.match(privacy, /delete your account at any time/i);
  assert.match(privacy, /Usage rows are kept for 90 days/);

  const support = await read("support.html");
  assert.match(support, /<h2 id="delete">Delete your account<\/h2>/,
               "the external account-deletion destination remains directly addressable");
  assert.match(support, /choose Delete account/);
  assert.match(support, /do not put your email address or other account identifiers/i,
               "access-loss requests never direct private account data into the public tracker");
  assert.match(support, /dedicated private product-support contact must be published/i,
               "the unresolved private support dependency stays explicit until launch");
});

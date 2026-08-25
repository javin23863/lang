import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("store rating inputs match the private direct-communication product", async () => {
  const [sources, declarations, privacy, terms] = await Promise.all([
    read("../STORE-RATING-SOURCES.md"),
    read("../STORE-DECLARATIONS.md"),
    read("../../windows/static/privacy.html"),
    read("../../windows/static/terms.html"),
  ]);

  assert.match(sources, /Verified against primary platform guidance on \*\*2026-08-26\*\*/);
  assert.match(sources, /developer\.apple\.com\/help\/app-store-connect\/manage-app-information\/set-an-app-age-rating/);
  assert.match(sources, /support\.google\.com\/googleplay\/android-developer\/answer\/7021383/);
  assert.match(sources, /\*\*Messaging and Chat: Yes\.\*\*/,
    "Apple must see the app's direct text, voice, and video communication capability");
  assert.match(sources, /\*\*Online Interaction or Content Exchange: Yes\.\*\*/,
    "Google IARC must see native user-to-user content exchange");
  assert.match(sources, /\*\*Social Media: No\.\*\*/,
    "private invite rooms are not a feed or discovery network");
  assert.match(sources, /\*\*Unrestricted Web Access: No\.\*\*/);
  assert.match(sources, /\*\*Advertising: No\.\*\*/);
  assert.match(sources, /Do not hard-code a numeric Apple age rating/i);
  assert.match(sources, /Do not copy a guessed numeric\/content rating/i);

  assert.match(declarations, /Apple `Messaging and Chat` is Yes/);
  assert.match(declarations, /`Online Interaction or Content Exchange` is Yes/);
  assert.match(declarations, /not designed for children under 13/i);
  assert.match(declarations, /no adult-only age gate/i);
  assert.doesNotMatch(declarations, /general adult communication/i,
    "store inputs cannot imply an 18+ restriction the product does not enforce");
  assert.match(declarations, /do not describe it as 18\+/i);

  assert.match(privacy, /not directed to children under 13/i,
    "public privacy wording and store audience inputs must agree");
  assert.doesNotMatch(terms, /adult-only|18\+/i,
    "terms do not impose an adult-only gate that could justify an 18+ store claim");
});

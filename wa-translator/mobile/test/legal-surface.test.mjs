import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../windows/static/", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("public legal pages share current Lingua chrome and deletion remains discoverable", async () => {
  const css = await read("legal.css");
  const legalRuntime = await read("legal-runtime.js");
  assert.match(css, /--canvas:#07110F/);
  assert.match(css, /--accent:#64D4C3/);
  assert.doesNotMatch(css, /#09141e/i, "retired launch palette is not used by legal surfaces");

  for (const page of ["privacy.html", "terms.html", "support.html", "delete-account.html"]) {
    const html = await read(page);
    assert.match(html, /<meta name="theme-color" content="#07110F">/,
                 `${page} matches the shared dark native/browser chrome`);
    assert.match(html, /Lingua Relay/);
    assert.match(html, /id="legalBack"/,
                 `${page} exposes one validated return-navigation target`);
    assert.match(html, /<script src="legal-runtime\.js"><\/script>/,
                 `${page} shares the legal return validator`);
    assert.doesNotMatch(html, /Buy credits/i,
                        `${page} does not advertise the retired purchase preview`);
  }

  // Policy text changed with the version 1.0 account/storage contract. Keep the
  // public effective date tied to the source that actually ships those terms.
  for (const page of ["privacy.html", "terms.html"]) {
    assert.match(await read(page), /Effective August 25, 2026/,
                 `${page} carries the current policy effective date`);
  }

  // A legal-page return may restore the call shell but can never become an
  // open redirect or restore the retired personal-label query parameter.
  assert.match(legalRuntime, /\?m=\(\?:voice\|chat\)/);
  assert.match(legalRuntime, /&m=\(\?:voice\|chat\)/);
  assert.doesNotMatch(legalRuntime, /\bn\b.*(?:voice|chat)/,
                      "legal return validation never accepts a personal-label parameter");
  assert.doesNotMatch(legalRuntime, /https?:\/\//,
                      "legal return navigation accepts no absolute origin");

  const privacy = await read("privacy.html");
  assert.match(privacy, /delete your account at any time/i);
  assert.match(privacy, /Usage rows are kept for 90 days/);
  assert.match(privacy, /does not sell credits or accept in-app payments/i);
  assert.doesNotMatch(privacy, /credit balance/i);
  assert.match(privacy, /one-way SHA-256 digest of that specific signed-out session token/i,
               "logout replay protection is disclosed without implying raw token retention");
  assert.match(privacy, /token itself is not stored in this revocation record/i);
  assert.match(privacy, /no longer than 30 days from sign-in/i,
               "security metadata has the same maximum lifetime as its session credential");
  assert.match(privacy, /any signed-out session revocation digests/i,
               "account deletion explicitly removes logout-security metadata too");

  const terms = await read("terms.html");
  assert.match(terms, /Version 1\.0 does not sell credits or accept in-app payments/);
  assert.doesNotMatch(terms, /disabled/i,
                      "terms no longer describe an intentionally dead purchase control");

  const support = await read("support.html");
  assert.match(support, /<h2 id="delete">Delete your account<\/h2>/,
               "the deletion route remains directly discoverable from support");
  assert.match(support, /href="delete-account\.html">Lingua Relay account-deletion page<\/a>/);
  assert.doesNotMatch(support, /spoken-translation-cloudflare\.workers\.dev/,
                      "support content is not pinned to the temporary development hostname");
  assert.match(support, /do not put your email address or other account identifiers/i,
               "access-loss requests never direct private account data into the public tracker");
  assert.match(support, /dedicated private product-support contact must be published/i,
               "the unresolved private support dependency stays explicit until launch");

  const deletion = await read("delete-account.html");
  assert.match(deletion, /Delete your Lingua Relay account/,
               "the Play deletion resource clearly identifies the product");
  assert.match(deletion, /do not need the mobile app/i,
               "account deletion remains available after uninstall");
  assert.match(deletion, /href="index\.html">Open Lingua Relay account controls<\/a>/,
               "the external resource leads to the browser account-deletion pathway");
  assert.match(deletion, /Deletion is immediate/);
  assert.match(deletion, /aggregate usage totals, and retained usage rows/);
  assert.match(deletion, /expire no later than 24 hours/,
               "the page accurately distinguishes account deletion from room-link expiry");
  assert.match(deletion, /dedicated private product-support contact is required before store submission/i);
  assert.doesNotMatch(deletion, /spoken-translation-cloudflare\.workers\.dev/,
                      "the Play deletion resource survives the eventual production-domain cutover");
});

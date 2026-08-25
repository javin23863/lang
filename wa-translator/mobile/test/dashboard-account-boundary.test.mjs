import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared native dashboard isolates account/auth presentation", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const account = await readFile(new URL("dashboard-account.js", root), "utf8");
  const dashboard = await readFile(new URL("dashboard.js", root), "utf8");

  const presenterTag = html.indexOf('<script src="/dashboard-account.js"></script>');
  const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');
  assert.ok(presenterTag >= 0 && dashboardTag > presenterTag,
    "account presenter loads before dashboard orchestration");

  assert.match(dashboard, /window\.LinguaDashboardAccount\.create/);
  assert.match(dashboard, /accountPresenter\.load\(\)/);
  assert.match(dashboard, /accountPresenter\.render\(account\)/);
  assert.doesNotMatch(dashboard, /dashboardFetch\(runtime\.apiUrl\("\/api\/me"\)/,
    "account snapshot fetching belongs to the account boundary");

  assert.match(account, /dashboardFetch\(runtime\.apiUrl\("\/api\/me"\)/);
  assert.match(account, /document\.body\.dataset\.auth = account\.signed_in \? "in" : "out"/);
  for (const marker of ["signInGoogle", "signInApple", "signInFacebook"]) {
    assert.ok(account.includes(marker), `account presenter keeps ${marker}`);
  }
  assert.match(account, /runtime\.apiUrl\("\/auth\/" \+ provider \+ "\/start"\)/);
  assert.doesNotMatch(account, /new AbortController\(\)/,
    "account requests reuse the shared deadline client");
  assert.doesNotMatch(account, /password/i,
    "account presenter never accepts or renders a password");

  for (const key of ["auth.signedInAs", "credits.usageEmpty", "credits.callMinutes",
                     "credits.chatMessages", "credits.ttsPhrases"]) {
    assert.ok(account.includes(key), `account presenter uses translated key ${key}`);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared native dashboard isolates invite sharing behavior", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const share = await readFile(new URL("dashboard-share.js", root), "utf8");
  const dashboard = await readFile(new URL("dashboard.js", root), "utf8");

  const shareTag = html.indexOf('<script src="/dashboard-share.js"></script>');
  const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');
  assert.ok(shareTag >= 0 && dashboardTag > shareTag,
    "share presenter loads before dashboard orchestration");

  assert.match(dashboard, /window\.LinguaDashboardShare\.create/);
  assert.match(dashboard, /sharePresenter\.copy/);
  assert.match(dashboard, /sharePresenter\.systemShare/);
  assert.match(dashboard, /sharePresenter\.whatsapp/);
  assert.match(dashboard, /sharePresenter\.line/);
  assert.match(dashboard, /sharePresenter\.toggleQr/);
  assert.doesNotMatch(dashboard, /https:\/\/wa\.me\/\?text=/);
  assert.doesNotMatch(dashboard, /navigator\.clipboard/);

  assert.match(share, /navigator\.clipboard/);
  assert.match(share, /runtime\.share\(/);
  assert.match(share, /https:\/\/wa\.me\/\?text=/);
  assert.match(share, /https:\/\/line\.me\/R\/share\?text=/);
  assert.doesNotMatch(share, /social-plugins\.line\.me/);
  assert.match(share, /window\.LinguaQR\.svg\(roomUrl\(room\)\)/);
  assert.match(share, /window\.open\(url, "_blank", "noopener"\)/);
  assert.match(share, /opened\.opener = null/);

  // The presenter receives the room URL through a function dependency and must
  // never inspect the host-control bearer or invent identity fields itself.
  assert.doesNotMatch(share, /host_control|Authorization|searchParams\.set\("n"/);
  for (const key of ["share.textVoice", "share.textChat", "share.textVideo", "share.title",
                     "home.linkCopied", "home.selectToCopy", "home.linkShared", "home.openBlocked"]) {
    assert.ok(share.includes(key), `share presenter uses translated key ${key}`);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared native dashboard isolates settings and lifecycle coordination", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const settings = await readFile(new URL("dashboard-settings.js", root), "utf8");
  const lifecycle = await readFile(new URL("dashboard-lifecycle.js", root), "utf8");
  const dashboard = await readFile(new URL("dashboard.js", root), "utf8");
  const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');

  for (const asset of ["dashboard-settings", "dashboard-lifecycle"]) {
    const tag = `<script src="/${asset}.js"></script>`;
    assert.ok(html.indexOf(tag) >= 0 && html.indexOf(tag) < dashboardTag,
      `${asset} loads before dashboard orchestration`);
  }

  assert.match(dashboard, /window\.LinguaDashboardSettings\.create/);
  assert.match(dashboard, /settingsPresenter\.install/);
  assert.doesNotMatch(dashboard, /new Intl\.DisplayNames/);
  assert.match(settings, /new Intl\.DisplayNames/);
  assert.match(settings, /runtime\.i18n\.use\(byId\("appLocaleSel"\)\.value\)/);
  assert.match(settings, /runtime\.i18n\.onChange/);
  assert.match(settings, /option\.selected = code === runtime\.i18n\.language/);

  assert.match(dashboard, /window\.LinguaDashboardLifecycle\.create/);
  assert.match(dashboard, /lifecycle\.install\(\)/);
  assert.match(dashboard, /await lifecycle\.ready\(\)/);
  assert.match(dashboard, /roomController\.refresh\(\)/);
  assert.match(dashboard, /refreshAccountIfUnavailable\(\)/);
  assert.doesNotMatch(dashboard, /navigator\.serviceWorker\.register/);
  assert.match(lifecycle, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(lifecycle, /document\.addEventListener\("visibilitychange", recoverWhenUsable\)/);
  assert.match(lifecycle, /window\.addEventListener\("online", recoverWhenUsable\)/);
  assert.match(lifecycle, /document\.visibilityState === "visible"/);
  assert.match(lifecycle, /await runtime\.ready\(\)/);
});

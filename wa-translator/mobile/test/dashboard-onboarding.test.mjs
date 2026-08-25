import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

function runOnboarding(source, {complete = false, failWrites = false} = {}) {
  class FakeElement {
    constructor(id = "") {
      this.id = id;
      this.hidden = true;
    }
    closest() { return this; }
  }

  const panel = new FakeElement("onboardingPanel");
  const values = new Map(complete ? [["lingua-relay.onboarding.v1", "1"]] : []);
  const listeners = new Map();
  const emitted = [];
  const context = {
    Element: FakeElement,
    document: {
      getElementById: id => id === "onboardingPanel" ? panel : null,
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrites) throw new Error("storage disabled");
        values.set(key, value);
      },
    },
    window: {
      LinguaProductEvents: {
        emit: name => {
          emitted.push(name);
          return true;
        },
      },
    },
  };
  vm.runInNewContext(source, context);
  return {FakeElement, panel, values, listeners, emitted};
}

test("prepared native dashboard carries local-only first-run onboarding", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const onboarding = await readFile(new URL("dashboard-onboarding.js", root), "utf8");
  const events = await readFile(new URL("product-events.js", root), "utf8");

  assert.match(html, /id="onboardingPanel"[^>]*hidden/);
  const eventTag = html.indexOf('<script src="/product-events.js" defer></script>');
  const onboardingTag = html.indexOf('<script src="/dashboard-onboarding.js" defer></script>');
  assert.ok(eventTag >= 0 && onboardingTag > eventTag,
    "privacy-safe event seam loads before onboarding emits lifecycle events");

  for (const key of [
    "auth.signInPrompt", "tile.video", "tile.voice", "tile.chat",
    "home.participantLink", "home.share", "gate.join",
  ]) assert.ok(html.includes(`data-i18n="${key}"`), `onboarding reuses translated key ${key}`);
  assert.doesNotMatch(html, /data-i18n="onboarding\./,
    "first-run copy reuses the fully translated product dictionary");

  assert.match(onboarding, /const STORAGE_KEY = "lingua-relay\.onboarding\.v1"/);
  assert.match(onboarding, /localStorage\.getItem\(STORAGE_KEY\) === "1"/);
  assert.match(onboarding, /localStorage\.setItem\(STORAGE_KEY, "1"\)/);
  assert.match(onboarding, /emit\("onboarding\.view"\)/);
  assert.match(onboarding, /emit\("onboarding\.complete"\)/);

  const firstRun = runOnboarding(onboarding);
  assert.equal(firstRun.panel.hidden, false, "first run reveals the explainer");
  assert.deepEqual(firstRun.emitted, ["onboarding.view"]);
  const signIn = new firstRun.FakeElement("signInGoogle");
  firstRun.listeners.get("click")({target: signIn});
  assert.equal(firstRun.panel.hidden, true, "meaningful host action completes onboarding");
  assert.equal(firstRun.values.get("lingua-relay.onboarding.v1"), "1");
  assert.deepEqual(firstRun.emitted, ["onboarding.view", "onboarding.complete"]);

  const returning = runOnboarding(onboarding, {complete: true});
  assert.equal(returning.panel.hidden, true, "returning users bypass completed onboarding");
  assert.deepEqual(returning.emitted, [], "completed onboarding is not counted as a new view");

  const restrictedStorage = runOnboarding(onboarding, {failWrites: true});
  const create = new restrictedStorage.FakeElement("createBtn");
  restrictedStorage.listeners.get("click")({target: create});
  assert.equal(restrictedStorage.panel.hidden, true,
    "storage restrictions never block the user's current action");
  assert.deepEqual(restrictedStorage.emitted, ["onboarding.view", "onboarding.complete"]);

  for (const forbidden of [
    "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "getUserMedia",
    "mediaDevices", "document.cookie", "host_control", "roomId",
  ]) assert.ok(!onboarding.includes(forbidden), `onboarding must not contain ${forbidden}`);

  assert.match(events, /"onboarding\.view": new Set\(\)/);
  assert.match(events, /"onboarding\.complete": new Set\(\)/);
});

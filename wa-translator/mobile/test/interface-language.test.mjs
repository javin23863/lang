import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../windows/static/", import.meta.url);

const runtimeSource = await readFile(new URL("app-runtime.js", staticRoot), "utf8");

// The base dictionary is the contract. Every shipped language is measured
// against it: a missing key silently falls back to English, and a stray key is
// a typo that will never be read.
function baseKeys() {
  const block = runtimeSource.match(/const BASE_STRINGS = Object\.freeze\(\{([\s\S]*?)\n  \}\);/);
  assert.ok(block, "app-runtime.js still declares BASE_STRINGS");
  return new Set([...block[1].matchAll(/^\s*"([\w.]+)":/gm)].map(match => match[1]));
}

function declaredLanguages() {
  const block = runtimeSource.match(/const TRANSLATED_LANGUAGES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block, "app-runtime.js still declares TRANSLATED_LANGUAGES");
  return new Set([...block[1].matchAll(/"([a-z]{2,3})"/g)].map(match => match[1]));
}

test("every declared interface language ships a dictionary", async () => {
  const files = (await readdir(new URL("i18n/", staticRoot))).filter(name => name.endsWith(".json"));
  const shipped = new Set(files.map(name => name.replace(/\.json$/, "")));
  const declared = declaredLanguages();
  assert.ok(declared.has("en"), "English is declared");
  assert.deepEqual([...declared].filter(code => code !== "en" && !shipped.has(code)), [],
                   "declared languages without a dictionary");
  assert.deepEqual([...shipped].filter(code => !declared.has(code)), [],
                   "dictionaries the runtime will never load");
});

test("every dictionary covers the English base exactly", async () => {
  const expected = baseKeys();
  assert.ok(expected.size > 100, "the base dictionary is populated");
  const files = (await readdir(new URL("i18n/", staticRoot))).filter(name => name.endsWith(".json"));
  assert.ok(files.length > 0, "dictionaries are present");
  for (const name of files) {
    const value = JSON.parse(await readFile(new URL(`i18n/${name}`, staticRoot), "utf8"));
    const keys = new Set(Object.keys(value));
    assert.deepEqual([...expected].filter(key => !keys.has(key)), [], `${name} is missing keys`);
    assert.deepEqual([...keys].filter(key => !expected.has(key)), [], `${name} has unknown keys`);
    for (const [key, text] of Object.entries(value)) {
      assert.equal(typeof text, "string", `${name}:${key} is a string`);
      assert.doesNotMatch(text, /[<>]/, `${name}:${key} carries no markup`);
    }
  }
});

test("placeholders survive translation in every dictionary", async () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  const base = JSON.parse(JSON.stringify(Object.fromEntries(
    [...runtimeSource.matchAll(/^\s*"([\w.]+)":\s*$/gm)].map(match => [match[1], ""]))));
  void base;
  const expected = new Map();
  const block = runtimeSource.match(/const BASE_STRINGS = Object\.freeze\(\{([\s\S]*?)\n  \}\);/)[1];
  for (const match of block.matchAll(/"([\w.]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
    expected.set(match[1], placeholders(match[2]));
  }
  const files = (await readdir(new URL("i18n/", staticRoot))).filter(name => name.endsWith(".json"));
  for (const name of files) {
    const value = JSON.parse(await readFile(new URL(`i18n/${name}`, staticRoot), "utf8"));
    for (const [key, text] of Object.entries(value)) {
      assert.deepEqual(placeholders(text), expected.get(key) ?? [],
                       `${name}:${key} keeps the same placeholders as English`);
    }
  }
});

test("the room and the dashboard read every string through a key", async () => {
  const expected = baseKeys();
  for (const page of ["room.html", "index.html"]) {
    const html = await readFile(new URL(page, staticRoot), "utf8");
    // `t('voice.' + voice.style)` builds its key at runtime; both halves it can
    // produce are in the base dictionary and are checked by the key sweep above.
    const used = [...html.matchAll(/\bt\(\s*'([\w.]+)'/g)]
      .map(match => match[1]).filter(key => !key.endsWith("."));
    const marked = [...html.matchAll(/data-i18n(?:-title|-label)?="([\w.]+)"/g)].map(m => m[1]);
    assert.ok(used.length + marked.length > 0, `${page} uses translated strings`);
    for (const key of [...used, ...marked]) {
      assert.ok(expected.has(key), `${page} asks for a key the base dictionary defines: ${key}`);
    }
  }
});

test("no screen text is written as an English literal", async () => {
  const expected = baseKeys();
  // Every one of these takes a dictionary key. A literal sentence slipped into
  // one is the exact defect this catches: it renders, so nothing looks broken,
  // and it stays English in all 100 languages.
  const calls = /\b(?:setStatus|showVideoNote|failVoice|finishSpeech\(item,)\s*\(?\s*'([^']*)'/g;
  for (const page of ["room.html", "index.html"]) {
    const html = await readFile(new URL(page, staticRoot), "utf8");
    for (const call of html.matchAll(calls)) {
      const key = call[1];
      if (!key) continue;
      assert.ok(expected.has(key),
                `${page} passes a dictionary key, not text: ${JSON.stringify(key)}`);
    }
  }
});

test("the call controls are glyphs, so no translation can overflow the bar", async () => {
  const room = await readFile(new URL("room.html", staticRoot), "utf8");
  for (const id of ["micBtn", "shareBtn", "camBtn", "voiceBtn", "leaveBtn"]) {
    const button = room.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`));
    assert.ok(button, `${id} is in the control bar`);
    const label = button[0].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim();
    assert.equal(label, "", `${id} carries no text that a translation could widen`);
    assert.match(button[0], /aria-label="/, `${id} still has an accessible name`);
  }
  // The four secondary controls carry their icon in the markup; the microphone
  // builds its own so it can swap between the live and muted glyph.
  for (const id of ["shareBtn", "camBtn", "voiceBtn", "leaveBtn"]) {
    assert.match(room.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`))[0], /<svg /,
                 `${id} shows an icon`);
  }
  assert.match(room, /const MIC_GLYPH = /, "the microphone has a glyph of its own");
  assert.match(room, /path\.setAttribute\('d', micOn \? MIC_GLYPH : MIC_MUTED_GLYPH\)/);
  // A glyph button never reads its own label out of the DOM.
  for (const write of room.matchAll(/\$\('(micBtn|shareBtn|camBtn|voiceBtn|leaveBtn)'\)\.(textContent|innerHTML|innerText)/g)) {
    assert.fail(`${write[1]} must not have its ${write[2]} overwritten`);
  }
});

test("the capability badge never says the same thing twice", async () => {
  const room = await readFile(new URL("room.html", staticRoot), "utf8");
  const badge = room.match(/function capabilityText\(profile\) \{[\s\S]*?\n\}/)[0];
  // "Captions · Captions only" shipped once; one branch now picks one label.
  assert.doesNotMatch(badge, /badges\.push/, "the badge is not assembled by appending");
  assert.match(badge, /capability\.captionsUnavailable/);
  assert.match(badge, /voice\.captionsOnly/);
});

test("the capability badge states no test counts", async () => {
  const room = await readFile(new URL("room.html", staticRoot), "utf8");
  const badge = room.match(/function capabilityText\(profile\) \{[\s\S]*?\n\}/);
  assert.ok(badge, "capabilityText is still the one place the badge is built");
  assert.doesNotMatch(badge[0], /voiceCount|capability\.voice/,
                      "the badge no longer reports how many voices exist");
});

test("the terms box is pre-agreed and still gates Join", async () => {
  const room = await readFile(new URL("room.html", staticRoot), "utf8");
  assert.match(room, /<input id="termsAgree" type="checkbox" checked>/);
  assert.match(room, /termsAccepted\(\) \{ return \$\('termsAgree'\)\.checked; \}/);
  assert.match(room, /if \(roleChosen \|\| !termsAccepted\(\)/);
});

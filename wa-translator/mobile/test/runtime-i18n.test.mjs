import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const staticRoot = new URL("../../windows/static/", import.meta.url);
const runtimeSource = await readFile(new URL("app-runtime.js", staticRoot), "utf8");

function element(attributes = {}) {
  return {
    dataset: {...attributes},
    textContent: "",
    title: "",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

// The runtime is a browser script, so it is run as one: a minimal window is
// enough to exercise every branch that decides what a person actually reads.
async function loadRuntime({elements = [], saved = {}, languages = ["en-US"], dictionaries = {}} = {}) {
  const store = {...saved};
  const requested = [];
  const documentElement = {lang: "", dir: ""};
  const context = {
    console,
    URL,
    location: {origin: "https://room.test", href: "https://room.test/room.html"},
    navigator: {languages},
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; },
    },
    document: {
      readyState: "complete",
      documentElement,
      addEventListener() {},
      querySelectorAll(selector) {
        const attribute = selector.slice(1, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
          .replace(/^data/, "").replace(/^./, (c) => c.toLowerCase());
        return elements.filter(el => attribute in el.dataset);
      },
    },
    async fetch(url) {
      const code = String(url).match(/\/i18n\/([\w-]+)\.json$/)?.[1];
      requested.push(code);
      const body = dictionaries[code];
      if (!body) return {ok: false, status: 404, json: async () => null};
      return {ok: true, status: 200, json: async () => body};
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(runtimeSource, context);
  // The runtime kicks off its own detection; let that settle before asserting.
  await new Promise(resolve => setImmediate(resolve));
  return {runtime: context.window.LinguaRuntime, documentElement, store, requested};
}

test("English is served from the runtime itself, with no fetch", async () => {
  const {runtime, requested, documentElement} = await loadRuntime();
  assert.equal(runtime.t("gate.join"), "Join room");
  assert.deepEqual(requested, []);
  assert.equal(documentElement.dir, "ltr");
});

test("an unknown key returns the key instead of blanking the screen", async () => {
  const {runtime} = await loadRuntime();
  assert.equal(runtime.t("no.such.key"), "no.such.key");
});

test("placeholders take the values the caller supplies", async () => {
  const {runtime} = await loadRuntime();
  assert.equal(runtime.t("status.roomFull", {limit: 4}), "Room is full (4 people)");
  assert.equal(runtime.t("stage.countMany", {count: 2}), "2 / 2");
  // A missing value leaves the placeholder rather than printing "undefined".
  assert.equal(runtime.t("status.roomFull", {}), "Room is full ({limit} people)");
});

test("choosing a language loads its dictionary and repaints marked elements", async () => {
  const heading = element({i18n: "gate.title"});
  const share = element({i18nTitle: "bar.shareTitle", i18nLabel: "bar.shareTitle"});
  const {runtime, documentElement} = await loadRuntime({
    elements: [heading, share],
    dictionaries: {es: {"gate.title": "Elige tu idioma", "bar.shareTitle": "Compartir esta sala"}},
  });
  await runtime.i18n.use("es-MX");
  assert.equal(runtime.i18n.language, "es");
  assert.equal(runtime.t("gate.title"), "Elige tu idioma");
  assert.equal(heading.textContent, "Elige tu idioma");
  assert.equal(share.title, "Compartir esta sala");
  assert.equal(share.attributes["aria-label"], "Compartir esta sala");
  assert.equal(documentElement.lang, "es-MX");
});

test("a key the dictionary omits falls back to English on its own", async () => {
  const {runtime} = await loadRuntime({dictionaries: {es: {"gate.title": "Elige tu idioma"}}});
  await runtime.i18n.use("es-ES");
  assert.equal(runtime.t("gate.title"), "Elige tu idioma");
  assert.equal(runtime.t("gate.join"), "Join room");
});

test("a right-to-left language lays the page out right-to-left", async () => {
  const {runtime, documentElement} = await loadRuntime({dictionaries: {ar: {"gate.join": "انضم"}}});
  await runtime.i18n.use("ar-SA");
  assert.equal(documentElement.dir, "rtl");
  await runtime.i18n.use("en-US");
  assert.equal(documentElement.dir, "ltr");
});

test("an unreachable dictionary still lays out its language correctly", async () => {
  // English text is the honest fallback, but an Arabic room is still Arabic:
  // dropping to left-to-right would mis-lay every caption that arrives.
  const {runtime, documentElement} = await loadRuntime();
  await runtime.i18n.use("ar-SA");
  assert.equal(runtime.i18n.language, "en", "text falls back");
  assert.equal(runtime.t("gate.join"), "Join room");
  assert.equal(documentElement.dir, "rtl", "direction follows the chosen language");
});

test("the device language is used before anyone has chosen", async () => {
  const {runtime, requested} = await loadRuntime({
    languages: ["fr-CA", "en-US"],
    dictionaries: {fr: {"gate.join": "Rejoindre le salon"}},
  });
  assert.deepEqual(requested, ["fr"]);
  assert.equal(runtime.t("gate.join"), "Rejoindre le salon");
});

test("a remembered room language outranks the device language", async () => {
  const {runtime} = await loadRuntime({
    saved: {"lingua-relay.locale": "de-DE"},
    languages: ["fr-FR"],
    dictionaries: {de: {"gate.join": "Raum betreten"}, fr: {"gate.join": "Rejoindre"}},
  });
  assert.equal(runtime.t("gate.join"), "Raum betreten");
});

test("a language with no dictionary never triggers a fetch", async () => {
  const {runtime, requested} = await loadRuntime({languages: ["xx-XX"]});
  assert.deepEqual(requested, []);
  assert.equal(runtime.i18n.language, "en");
});

test("listeners are told about the language, including at registration", async () => {
  const seen = [];
  const {runtime} = await loadRuntime({dictionaries: {it: {"gate.join": "Entra"}}});
  const stop = runtime.i18n.onChange(language => seen.push(language));
  await runtime.i18n.use("it-IT");
  stop();
  await runtime.i18n.use("en-US");
  assert.deepEqual(seen, ["en", "it"], "called once on registration, once per change, then never again");
});

test("a throwing listener does not stop the others", async () => {
  const seen = [];
  const {runtime} = await loadRuntime({dictionaries: {pt: {"gate.join": "Entrar"}}});
  runtime.i18n.onChange(() => { throw new Error("listener is broken"); });
  runtime.i18n.onChange(language => seen.push(language));
  await runtime.i18n.use("pt-BR");
  assert.ok(seen.includes("pt"));
});

test("every shipped language is offered to the dashboard picker", async () => {
  const {runtime} = await loadRuntime();
  assert.ok(runtime.i18n.languages.includes("en"));
  assert.ok(runtime.i18n.languages.length >= 100);
  const offered = [...runtime.i18n.languages];
  assert.deepEqual(offered, [...offered].sort(), "the picker lists them in a stable order");
});

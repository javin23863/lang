import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("store privacy classifications retain current primary-source rationale", async () => {
  const sources = await read("../STORE-PRIVACY-SOURCES.md");

  assert.match(sources, /Verified against primary platform guidance on \*\*2026-08-26\*\*/);
  assert.match(sources, /developer\.apple\.com\/app-store\/app-privacy-details/);
  assert.match(sources, /support\.google\.com\/googleplay\/android-developer\/answer\/10787469/);
  assert.match(sources, /processed ephemerally/);
  assert.match(sources, /Device or other IDs/);
  assert.match(sources, /Other Data Types/);
  assert.match(sources, /service provider/);
});

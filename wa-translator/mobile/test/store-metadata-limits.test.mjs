import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const read = async path => (await readFile(new URL(path, import.meta.url), "utf8")).trim();

test("Google Play text stays inside current listing limits", async () => {
  const root = "../fastlane/metadata/android/en-US/";
  const title = await read(`${root}title.txt`);
  const shortDescription = await read(`${root}short_description.txt`);
  const fullDescription = await read(`${root}full_description.txt`);

  assert.ok(title.length >= 1 && title.length <= 30, "Play title must be 30 characters or fewer");
  assert.ok(shortDescription.length >= 1 && shortDescription.length <= 80,
    "Play short description must be 80 characters or fewer");
  assert.ok(fullDescription.length >= 1 && fullDescription.length <= 4000,
    "Play full description must be 4000 characters or fewer");
});

test("App Store text stays inside current metadata limits", async () => {
  const root = "../fastlane/metadata/ios/en-US/";
  const name = await read(`${root}name.txt`);
  const subtitle = await read(`${root}subtitle.txt`);
  const description = await read(`${root}description.txt`);
  const keywords = await read(`${root}keywords.txt`);

  assert.ok(name.length >= 2 && name.length <= 30, "App Store name must be 2-30 characters");
  assert.ok(subtitle.length <= 30, "App Store subtitle must be 30 characters or fewer");
  assert.ok(description.length >= 1 && description.length <= 4000,
    "App Store description must be 4000 characters or fewer");
  assert.ok(Buffer.byteLength(keywords, "utf8") <= 100,
    "App Store keywords must be 100 UTF-8 bytes or fewer");
});

test("store URLs point at the production legal and support surfaces", async () => {
  const ios = "../fastlane/metadata/ios/en-US/";
  const origin = "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev";
  assert.equal(await read(`${ios}privacy_url.txt`), `${origin}/privacy`);
  assert.equal(await read(`${ios}support_url.txt`), `${origin}/support`);
  assert.equal(await read(`${ios}marketing_url.txt`), origin + "/");
});

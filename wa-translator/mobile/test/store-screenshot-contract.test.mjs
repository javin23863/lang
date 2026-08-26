import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const mobile = new URL("../", import.meta.url);

test("store screenshot pipeline carries the full activation story", async () => {
  const script = await readFile(new URL("scripts/prepare-store-screenshots.py", mobile), "utf8");
  const expected = [
    "01-dashboard.png",
    "02-room-control.png",
    "03-choose-language.png",
    "04-room.png",
  ];

  for (const name of expected) {
    await access(new URL(`store/screenshots/en-US/${name}`, mobile));
    assert.ok(script.includes(`(\"${name}\", \"${name}\")`), `${name} is exported to both stores`);
  }
  assert.match(script, /for stale in target\.glob\("\*\.png"\):/,
    "regeneration removes stale screenshots before writing the current set");
  assert.match(script, /write_set\(ANDROID, \(1080, 2340\)\)/);
  assert.match(script, /write_set\(IOS, \(1290, 2796\)\)/);
  assert.doesNotMatch(script, /INPUTS = \(\(\"01-dashboard\.png\"[^\n]+\"04-room\.png\"/,
    "the pipeline no longer exports only the first and last state");
});

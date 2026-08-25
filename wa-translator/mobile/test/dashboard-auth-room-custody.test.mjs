import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../www/dashboard.js", import.meta.url), "utf8");

test("signed-out boot purges stale host control while outages preserve it without restoration", () => {
  assert.match(source,
    /if \(!account\.signed_in && !account\.unavailable\) \{[\s\S]*?await roomController\.discard\(\);[\s\S]*?account = \{\.\.\.account, providers: \[\], unavailable: true\};[\s\S]*?\}/,
    "confirmed signed-out state clears local room administration and blocks account transition if cleanup fails");
  assert.match(source, /if \(account\.signed_in\) await roomController\.restore\(\);/,
    "persisted room administration is restored only after authenticated identity is confirmed");
  assert.doesNotMatch(source, /applyAccountAvailability\(\);\s*await roomController\.restore\(\);/,
    "signed-out or unavailable snapshots cannot fall through to unconditional room restoration");
});

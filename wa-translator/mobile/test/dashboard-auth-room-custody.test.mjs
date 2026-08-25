import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../www/dashboard.js", import.meta.url), "utf8");

test("account snapshots and persisted host control are reconciled at boot and outage recovery", () => {
  assert.match(source,
    /async function reconcileAccountRoomCustody\(snapshot\) \{[\s\S]*?if \(snapshot\.signed_in\) \{[\s\S]*?await roomController\.restore\(\);[\s\S]*?return snapshot;[\s\S]*?if \(snapshot\.unavailable\) return snapshot;[\s\S]*?await roomController\.discard\(\);[\s\S]*?return snapshot;[\s\S]*?return \{\.\.\.snapshot, providers: \[\], unavailable: true\};[\s\S]*?\}/,
    "signed-in state restores, outages preserve without restore, signed-out state purges, and cleanup failure blocks account transition");
  assert.equal((source.match(/await reconcileAccountRoomCustody\(/g) ?? []).length, 2,
    "the same custody reconciliation must run both at startup and after an unavailable account snapshot recovers");
  assert.match(source,
    /async function refreshAccountIfUnavailable\(\) \{[\s\S]*?const loaded = await accountPresenter\.load\(\);[\s\S]*?account = await reconcileAccountRoomCustody\(loaded\);[\s\S]*?accountPresenter\.render\(account\);/,
    "visibility recovery cannot render recovered providers before room custody is reconciled");
  assert.match(source,
    /account = await reconcileAccountRoomCustody\(await accountPresenter\.load\(\)\);[\s\S]*?accountPresenter\.render\(account\);/,
    "startup uses the same account-room custody boundary as recovery");
});

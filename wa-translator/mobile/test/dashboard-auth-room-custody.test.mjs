import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../www/dashboard.js", import.meta.url), "utf8");

test("account snapshots and persisted host control are reconciled at boot and outage recovery", () => {
  assert.match(source,
    /async function reconcileAccountRoomCustody\(snapshot\) \{[\s\S]*?if \(snapshot\.signed_in\) \{[\s\S]*?await roomController\.restore\(\);[\s\S]*?return snapshot;[\s\S]*?if \(snapshot\.unavailable\) return snapshot;[\s\S]*?if \(await roomController\.discard\(\)\) return snapshot;[\s\S]*?return \{\.\.\.snapshot, providers: \[\], unavailable: true\};[\s\S]*?\}/,
    "signed-in state restores, outages preserve without restore, and signed-out providers stay hidden until persistent bearer retirement is confirmed");
  assert.equal((source.match(/await reconcileAccountRoomCustody\(/g) ?? []).length, 2,
    "the same custody reconciliation must run both at startup and after an unavailable account snapshot recovers");
  assert.match(source,
    /async function refreshAccountIfUnavailable\(\) \{[\s\S]*?const loaded = await accountPresenter\.load\(\);[\s\S]*?account = await reconcileAccountRoomCustody\(loaded\);[\s\S]*?accountPresenter\.render\(account\);/,
    "visibility recovery cannot render recovered providers before room custody is reconciled");
  assert.match(source,
    /account = await reconcileAccountRoomCustody\(await accountPresenter\.load\(\)\);[\s\S]*?accountPresenter\.render\(account\);/,
    "startup uses the same account-room custody boundary as recovery");
});

test("completed server account transitions reload even when persistent room cleanup fails", () => {
  assert.match(source,
    /async function deleteAccount\(\) \{[\s\S]*?let serverDeleted = false;[\s\S]*?if \(!response\.ok\) throw new Error\("delete failed"\);[\s\S]*?serverDeleted = true;[\s\S]*?await roomController\.discard\(\);\s*location\.reload\(\);[\s\S]*?catch \(_\) \{\s*if \(serverDeleted\) \{[\s\S]*?location\.reload\(\);\s*return;[\s\S]*?setNotice\("auth\.deleteFailed"\);/,
    "a successful server deletion cannot be relabeled as failed just because secure-storage cleanup needs a boot retry");
  assert.match(source,
    /signOutBtn[\s\S]*?let serverSignedOut = false;[\s\S]*?if \(!response\.ok\) throw new Error\("logout failed"\);[\s\S]*?serverSignedOut = true;[\s\S]*?await roomController\.discard\(\);\s*location\.reload\(\);[\s\S]*?catch \(_\) \{\s*if \(serverSignedOut\) \{[\s\S]*?location\.reload\(\);\s*return;[\s\S]*?setAuthStatus\("auth\.signOutFailed"\);/,
    "a revoked server session always reloads into the signed-out custody gate even if secure-storage cleanup throws");
});

test("sign-out closes active room custody before session revocation and shares the async action lock", () => {
  assert.match(source,
    /function syncBusyControls\(\) \{[\s\S]*?const blocked = roomBusy \|\| accountActionBusy;[\s\S]*?"signOutBtn", "deleteAccountBtn"[\s\S]*?\.disabled = blocked;/,
    "room and account operations must disable both account-transition controls while either async boundary is active");

  const start = source.indexOf('$("signOutBtn").onclick = async () => {');
  const end = source.indexOf('$("deleteAccountBtn").onclick = deleteAccount;', start);
  assert.ok(start >= 0 && end > start, "sign-out handler must remain explicit in the dashboard source");
  const signOut = source.slice(start, end);
  assert.match(signOut, /if \(accountActionBusy \|\| roomController\.isBusy\(\)\) return;/,
    "sign-out cannot start while another room/account transition is already active");
  assert.match(signOut, /setAccountBusy\(true\);/,
    "sign-out must hold the shared account-transition lock for its full async path");

  const closeIndex = signOut.indexOf("await roomController.close(false)");
  const logoutIndex = signOut.indexOf('runtime.apiUrl("/auth/logout")');
  assert.ok(closeIndex >= 0 && logoutIndex > closeIndex,
    "an active room must be confirmed closed before the logout request revokes account custody");
  assert.match(signOut, /finally \{\s*if \(!serverSignedOut\) setAccountBusy\(false\);\s*\}/,
    "failed or cancelled sign-out must release the account-transition lock for retry");
});

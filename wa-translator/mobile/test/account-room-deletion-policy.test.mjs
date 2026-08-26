import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");

const [privacy, terms, deletion, declarations, privacySources, reviewInputs, checklist, registry, shipping] =
  await Promise.all([
    read("../../windows/static/privacy.html"),
    read("../../windows/static/terms.html"),
    read("../../windows/static/delete-account.html"),
    read("../STORE-DECLARATIONS.md"),
    read("../STORE-PRIVACY-SOURCES.md"),
    read("../REVIEW-INPUTS.md"),
    read("../LAUNCH-CHECKLIST.md"),
    read("../../cloudflare/src/account-room-registry.ts"),
    read("../../cloudflare/src/session-issuance-entry.ts"),
  ]);

test("account deletion closes owned rooms before account erasure is reported successful", () => {
  for (const source of [privacy, terms, deletion, declarations, reviewInputs]) {
    assert.match(source, /close(?:s|d)? every still-live room owned by (?:that|the) account/i);
  }
  assert.match(privacy, /deletion does not report success and the account remains available/i);
  assert.match(declarations, /deletion fails closed and the account remains/i);
  assert.match(reviewInputs, /deletion fails closed and remains retryable/i);

  for (const source of [privacy, deletion, declarations, checklist]) {
    assert.doesNotMatch(source, /already-issued participant rooms remain independent until/i);
    assert.doesNotMatch(source, /rooms you created keep running until their links expire/i);
    assert.doesNotMatch(source, /already-issued room can survive until/i);
  }
});

test("owned-room routing data is bounded, minimized, and retained no longer than room life", () => {
  assert.match(registry, /const OWNED_ROOM_LIMIT = 128/);
  assert.match(registry, /const ROOM_MAX_FUTURE_MS = 24 \* 60 \* 60 \* 1000 \+ 60_000/);
  assert.match(registry, /const CLOSE_BATCH_SIZE = 16/);
  assert.match(registry, /DELETION_FENCE_TTL_MS = 2 \* 60 \* 1000/);
  assert.match(privacy, /internal room routing ID and its expiry/);
  assert.match(privacy, /not the participant link or host-control bearer/);
  assert.match(declarations, /bounded internal room ID\/expiry/);
  assert.match(declarations, /never later than 24 hours/);
  assert.match(privacySources, /linked `Product Interaction`/);
  assert.match(privacySources, /linked `App interactions`/);
});

test("room creation registers ownership before exposing the room capability", () => {
  assert.match(shipping, /async function registeredRoomCreation/);
  assert.match(shipping, /https:\/\/users\.internal\/owned-rooms/);
  assert.match(shipping, /if \(status === 204\) return response/);
  assert.match(shipping, /await closeUnregisteredRoom\(env, roomId, expiresAt\)/);
  assert.match(registry, /await transaction\.put\(DELETION_FENCE_KEY, \{startedAt: now\}\)/);
  assert.match(registry, /if \(activeFence\(fence, now\)\) return "deleting"/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");

const [privacy, terms, declarations, ratingSources, reviewInputs, blockingSource] = await Promise.all([
  read("../../windows/static/privacy.html"),
  read("../../windows/static/terms.html"),
  read("../STORE-DECLARATIONS.md"),
  read("../STORE-RATING-SOURCES.md"),
  read("../REVIEW-INPUTS.md"),
  read("../../windows/static/room-blocking.js"),
]);

test("public privacy and terms disclose the installation-scoped participant safety contract", () => {
  assert.match(privacy, /random pseudonymous participant-safety ID/);
  assert.match(privacy, /bounded list of blocked participant-safety IDs/);
  assert.match(privacy, /only with the live room socket state/);
  assert.match(privacy, /never receives the device's block list/);
  assert.match(privacy, /Clearing app\/site data or reinstalling resets/);
  assert.match(privacy, /Device-local participant safety blocks are separate from the account/);

  assert.match(terms, /<strong>Block participant<\/strong>/);
  assert.match(terms, /later private-room encounter/);
  assert.match(terms, /refuses admission when either participant presents a block relationship/);
  assert.match(terms, /not a guest account, public profile, credential, contact identifier, or searchable identity/);
});

test("store and reviewer sources describe participant blocking instead of the retired room-only rationale", () => {
  for (const source of [declarations, ratingSources, reviewInputs]) {
    assert.match(source, /Block participant|participant-blocking|participant can independently block/i);
  }
  assert.doesNotMatch(declarations, /no persistent guest identity/);
  assert.doesNotMatch(declarations, /complete service relationship between the two participants/);
  assert.doesNotMatch(reviewInputs, /no persistent cross-room identity/);
  assert.match(reviewInputs, /later private-room\s+join presenting the same pseudonymous safety ID is refused before admission/);
});

test("Google Data Safety source treats off-device installation safety identifiers conservatively", () => {
  assert.match(declarations, /random installation participant-safety ID and bounded blocked-ID/);
  assert.match(declarations, /Device or other IDs/);
  assert.match(declarations, /processed ephemerally off-device/);
  assert.match(declarations, /local blocked-ID list\s+is never relayed to another participant/);
});

test("blocking implementation remains local, bounded, and free of a server block-history API", () => {
  assert.match(blockingSource, /lingua-relay\.block-id\.v1/);
  assert.match(blockingSource, /lingua-relay\.blocked-participants\.v1/);
  assert.match(blockingSource, /const BLOCK_LIST_LIMIT = 128/);
  assert.match(blockingSource, /blocked_ids = blockedIds\.slice\(-BLOCK_LIST_LIMIT\)/);
  assert.doesNotMatch(blockingSource, /\/api\/(?:v1\/)?blocks/);
});

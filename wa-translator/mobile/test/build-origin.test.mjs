import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_ORIGIN,
  STAGING_ORIGIN,
  resolvePublicOrigin,
} from "../scripts/build-bridge.mjs";

test("native bridge defaults to the production Worker", () => {
  assert.equal(resolvePublicOrigin(), PRODUCTION_ORIGIN);
  assert.equal(resolvePublicOrigin(""), PRODUCTION_ORIGIN);
});

test("native bridge accepts the isolated staging Worker", () => {
  assert.equal(resolvePublicOrigin(STAGING_ORIGIN), STAGING_ORIGIN);
});

test("native bridge rejects arbitrary backend origins", () => {
  assert.throws(
    () => resolvePublicOrigin("https://example.invalid"),
    /Unsupported LINGUA_PUBLIC_ORIGIN/,
  );
});

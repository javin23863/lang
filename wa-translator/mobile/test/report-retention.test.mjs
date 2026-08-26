import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("abuse reports enforce both report retention and shorter routing retention on every access", async () => {
  const wrapper = await read("../../cloudflare/src/report-inbox.ts");
  const launch = await read("../../cloudflare/src/launch-entry.ts");

  assert.match(wrapper, /class ReportInbox extends WorkerReportInbox/,
               "the existing Durable Object class/migration is wrapped rather than replaced");
  assert.match(wrapper, /const REPORT_RETENTION_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(wrapper, /const cutoffMs = nowMs - REPORT_RETENTION_MS/);
  assert.match(wrapper, /if \(!Number\.isFinite\(createdAt\) \|\| createdAt > nowMs \|\| createdAt < cutoffMs\) \{\s*await this\.ctx\.storage\.delete\(key\)/,
               "missing, malformed, future, and over-retention reports are deleted before direct resolve can use them");
  assert.match(wrapper, /delete retained\.room_id/);
  assert.match(wrapper, /delete retained\.room_expires/);
  assert.match(wrapper, /const MAX_ROUTING_LIFETIME_MS = 24 \* 60 \* 60 \* 1000/,
               "routing cannot outlive the documented room lifetime");
  assert.match(wrapper, /expiryMs <= createdAt \+ MAX_ROUTING_LIFETIME_MS/,
               "an old report cannot slide its routing deadline forward based on the current clock");
  assert.doesNotMatch(wrapper, /expires <= nowSeconds \+ MAX_ROUTING_LIFETIME/,
                      "routing lifetime is not recalculated relative to each later access");
  assert.match(wrapper, /const ROOM_ID_PATTERN = \/\^\[A-Za-z0-9_-\]\{24\}\$\//,
               "the routing identifier must retain the exact internal room-id shape");
  assert.match(wrapper, /if \(!validRoomId \|\| !validLifetime \|\| expires! <= nowSeconds\)/,
               "invalid or expired routing is stripped instead of skipped until report deletion");
  assert.match(wrapper, /nextRoomExpiryMs < existing/,
               "room expiry may move the inbox alarm earlier but never later than retention");
  assert.match(wrapper, /await this\.pruneRetentionAndRouting\(\);[\s\S]*?const resolve =/,
               "retention is enforced before the direct resolve path reads a report");
  assert.match(wrapper, /const response = await super\.fetch\(request\);[\s\S]*?await this\.pruneRetentionAndRouting\(\);[\s\S]*?return response/,
               "every base list/insert operation is followed by alarm/routing reconciliation");
  assert.match(wrapper, /await super\.alarm\(\);[\s\S]*?await this\.pruneRetentionAndRouting\(\)/,
               "the base cleanup runs before the next shorter routing alarm is restored");
  assert.match(wrapper, /return new Response\("Not found", \{status: 404\}\)/,
               "moderator resolution stops once retained routing data is unavailable");

  assert.match(launch, /import \{ ReportInbox \} from "\.\/report-inbox"/,
               "the deployment entrypoint exports the bounded-routing implementation");
  assert.doesNotMatch(launch,
    /import mobileEntry, \{[^}]*ReportInbox[^}]*\} from "\.\/mobile-entry"/,
    "the legacy 30-day routing implementation is not exported by the deployment entrypoint");
});

test("public and store disclosures distinguish report and routing lifetimes", async () => {
  const privacy = await read("../../windows/static/privacy.html");
  const declarations = await read("../STORE-DECLARATIONS.md");

  for (const source of [privacy, declarations]) {
    assert.match(source, /30 days/i,
                 "category-only moderation reports retain their documented bounded history");
    assert.match(source, /24 hours/i,
                 "internal room-routing metadata has the shorter room lifetime");
  }
  assert.match(privacy, /routing\s+ID and its room-expiry value are removed when the room expires/i);
  assert.match(declarations,
    /routing\s+ID and room-expiry value\s+exist only while moderator closure can still work/i);
});

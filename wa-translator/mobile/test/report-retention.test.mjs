import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("abuse report routing metadata expires with the room", async () => {
  const wrapper = await read("../../cloudflare/src/report-inbox.ts");
  const launch = await read("../../cloudflare/src/launch-entry.ts");

  assert.match(wrapper, /class ReportInbox extends WorkerReportInbox/,
               "the existing Durable Object class/migration is wrapped rather than replaced");
  assert.match(wrapper, /delete retained\.room_id/);
  assert.match(wrapper, /delete retained\.room_expires/);
  assert.match(wrapper, /expires <= nowSeconds/,
               "routing fields are removed as soon as their room expiry is reached");
  assert.match(wrapper, /nextRoomExpiryMs < existing/,
               "room expiry may move the inbox alarm earlier but never later than retention");
  assert.match(wrapper, /const response = await super\.fetch\(request\);[\s\S]*?await this\.pruneExpiredRouting\(\);[\s\S]*?return response/,
               "every base list/insert operation is followed by routing-alarm reconciliation");
  assert.match(wrapper, /await super\.alarm\(\);[\s\S]*?await this\.pruneExpiredRouting\(\)/,
               "the 30-day cleanup runs before the next shorter routing alarm is restored");
  assert.match(wrapper, /return new Response\("Not found", \{status: 404\}\)/,
               "moderator resolution stops once routing data is unavailable");

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
  assert.match(privacy, /routing ID and its room-expiry value are removed when the room expires/i);
  assert.match(declarations, /routing ID and room-expiry value exist only while moderator closure can still work/i);
});

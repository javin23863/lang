import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("privacy-safe product telemetry seam", () => {
  it("ships a vendor-neutral, non-persisting event contract on the dashboard", async () => {
    const dashboard = await exports.default.fetch(`${ORIGIN}/`);
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toContain('<script src="/product-events.js" defer></script>');

    const response = await exports.default.fetch(`${ORIGIN}/product-events.js`);
    expect(response.status).toBe(200);
    const source = await response.text();

    for (const event of [
      "app.open", "auth.state", "room.create.intent", "room.create.result",
      "invite.share.intent", "room.open.intent", "room.close.result", "locale.change",
    ]) expect(source).toContain(`"${event}"`);

    expect(source).toContain('new CustomEvent("lingua:product-event"');
    expect(source).toContain("FORBIDDEN_FIELD");
    expect(source).toContain("SAFE_VALUE");

    // The seam is intentionally local-only. A later analytics adapter must be a
    // deliberate privacy/store-declaration change, never hidden inside this file.
    for (const forbidden of [
      "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "localStorage",
      "sessionStorage", "document.cookie",
    ]) expect(source).not.toContain(forbidden);
  });
});

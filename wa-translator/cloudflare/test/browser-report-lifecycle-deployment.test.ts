import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser report lifecycle deployment", () => {
  it("serves confirmed-report teardown that preserves only the active report request", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("const reportControlControllers = new WeakSet()");
    expect(source).toContain("function abortControlRequests(preserveReportRequest = false)");
    expect(source).toContain("preserveReportRequest && reportControlControllers.has(controller)");
    expect(source).toContain("function endRoomLifecycle(preserveReportRequest = false)");
    expect(source).toMatch(/if \(reportButton\.disabled\) \{[\s\S]*?quiesceRoomForReport\(\);[\s\S]*?endRoomLifecycle\(true\)/);
    expect(source).toContain('if (url.pathname === "/api/reports") reportControlControllers.add(controller)');
  });
});

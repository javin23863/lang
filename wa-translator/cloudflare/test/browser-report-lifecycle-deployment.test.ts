import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser report lifecycle deployment", () => {
  it("serves confirmed-report teardown that preserves only the active report request", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("let browserReportDeliveryCount = 0");
    expect(source).toContain("let browserConfirmedReportPending = false");
    expect(source).toContain("function browserConfirmedReportActive()");
    expect(source).toContain("const reportControlControllers = new WeakSet()");
    expect(source).toContain("function abortControlRequests(preserveReportRequest = false)");
    expect(source).toContain("preserveReportRequest && reportControlControllers.has(controller)");
    expect(source).toContain("function endRoomLifecycle(preserveReportRequest = false)");
    expect(source).toMatch(/browserConfirmedReportActive\(\)[\s\S]*?notifyServer === false && preserveServerClose !== true/);
    expect(source).toMatch(/const preserveReportRequest = browserConfirmedReportActive\(\);[\s\S]*?abortControlRequests\(preserveReportRequest\)/);
    expect(source).toMatch(/if \(reportButton\.disabled\) \{[\s\S]*?browserConfirmedReportPending = true;[\s\S]*?quiesceRoomForReport\(\);[\s\S]*?endRoomLifecycle\(true\)/);
    expect(source).toMatch(/const reportRequest = url\.pathname === "\/api\/reports";[\s\S]*?reportControlControllers\.add\(controller\);[\s\S]*?browserReportDeliveryCount\+\+/);
    expect(source).toMatch(/browserReportDeliveryCount = Math\.max\(0, browserReportDeliveryCount - 1\);[\s\S]*?browserConfirmedReportPending = false/);
  });
});

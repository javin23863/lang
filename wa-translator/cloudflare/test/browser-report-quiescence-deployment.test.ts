import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser confirmed-report quiescence deployment", () => {
  it("serves local media teardown that keeps report delivery and socket registration separate", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("function quiesceRoomForReport()");
    expect(source).toContain("stopCapturedBrowserStream(mediaStream)");
    expect(source).toContain("for (const state of peers.values())");
    expect(source).toContain("state?.pc?.close?.()");
    expect(source).toContain("setChatEnabled(false)");
    expect(source).toContain("Promise.resolve(context.close()).catch(() => {})");
    expect(source).toMatch(/if \(reportButton\.disabled\) \{[\s\S]*?quiesceRoomForReport\(\);[\s\S]*?endRoomLifecycle\(true\)/);
    expect(source).not.toMatch(/function quiesceRoomForReport\(\)[\s\S]*?disconnectRoom\(/);
  });
});

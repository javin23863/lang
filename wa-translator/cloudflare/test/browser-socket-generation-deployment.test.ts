import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser socket generation deployment", () => {
  it("serves disconnect-invalidated socket ownership guards before room message and close handlers", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("let browserRoomGeneration = 0");
    expect(source).toContain("function invalidateBrowserRoomGeneration()");
    expect(source).toContain("browserRoomGeneration++");
    expect(source).toContain("const socketGeneration = browserRoomGeneration");
    expect(source).toContain('socket.addEventListener("message", event => {');
    expect(source).toContain("socketGeneration !== browserRoomGeneration");
    expect(source).toContain("activeRoomSocket !== socket");
    expect(source).toContain("event.stopImmediatePropagation?.()");
    expect(source).toContain('socket.addEventListener("close", event => {');
    expect(source).toContain("const stale = socketGeneration !== browserRoomGeneration");
    expect(source).toContain("invalidateBrowserRoomGeneration();\n        invalidatePendingBrowserMedia();");
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser capability recovery deployment", () => {
  it("serves bounded pre-join capability retry behavior in the deferred room bootstrap", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("const CAPABILITY_RETRY_WINDOW_MS = 60 * 1000");
    expect(source).toContain("const CAPABILITY_RETRY_MAX_PER_WINDOW = 3");
    expect(source).toContain('gateFailureKey === "gate.languagesUnavailable"');
    expect(source).toContain("catalog === null && locales.size === 0 && voices.size === 0");
    expect(source).toContain("!roleChosen && !explicitLeave && !terminalRoom");
    expect(source).toContain("!roomSuspended && !roomLifecycleEnded");
    expect(source).toContain('gateFailureKey = ""');
    expect(source).toContain("Promise.resolve(loadCapabilities())");
    expect(source).toContain('window.addEventListener("online", retryCapabilities)');
    expect(source).toContain("event.detail?.isActive) retryCapabilities()");
    expect(source).toContain('document.visibilityState === "visible"');
    expect(source).toContain("ROOM_CONTROL_FETCH_TIMEOUT_MS + 1000");
  });
});

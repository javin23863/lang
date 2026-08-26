import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser transport gate deployment", () => {
  it("serves fail-closed browser room transport enforcement", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("const browserRoomSupported = native || !roomRoute || (");
    expect(source).toContain('typeof window.fetch === "function"');
    expect(source).toContain('typeof window.WebSocket === "function"');
    expect(source).toContain('typeof window.RTCPeerConnection === "function"');
    expect(source).toContain("function renderUnsupportedRoomGate()");
    expect(source).toContain('gateFailureKey = "gate.updateRequired"');
    expect(source).toContain("updateRoleGate = function transportAwareRoleGate");
    expect(source).toContain("event.stopImmediatePropagation?.()");
    expect(source).toContain("{capture: true}");
    expect(source).toContain("if (!browserRoomSupported");
    expect(source).toContain("else renderUnsupportedRoomGate()");
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser stale peer work deployment", () => {
  it("serves lifecycle-aware message and peer-warning guards in the deferred room bootstrap", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain('const PEER_NETWORK_NOTE_KEYS = new Set(["note.videoSlow", "note.videoFailed"])');
    expect(source).toContain("function browserRoomWorkActive()");
    expect(source).toContain("roomSuspended || roomLifecycleEnded");
    expect(source).toContain('typeof leaving !== "undefined" && leaving');
    expect(source).toContain('typeof explicitLeave !== "undefined" && explicitLeave');
    expect(source).toContain('typeof terminalRoom !== "undefined" && terminalRoom');
    expect(source).toContain("const roomHandle = handle");
    expect(source).toContain("handle = async function lifecycleAwareRoomHandle");
    expect(source).toContain("if (!browserRoomWorkActive()) return");
    expect(source).toContain("const roomShowVideoNote = showVideoNote");
    expect(source).toContain("PEER_NETWORK_NOTE_KEYS.has(key)");
    expect(source).toContain("currentPeerNeedsNetworkNote()");
    expect(source).toContain('pc.iceConnectionState === "connected"');
    expect(source).toContain('pc.iceConnectionState === "completed"');
    expect(source).toContain('pc.connectionState === "connected"');
  });
});

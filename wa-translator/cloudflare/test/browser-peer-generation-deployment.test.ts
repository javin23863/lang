import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser peer generation deployment", () => {
  it("serves peer-generation guards for async negotiation, signal ownership, events, and stale handler failures", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("const RoomPeerConnection = window.RTCPeerConnection");
    expect(source).toContain("const peerGenerations = new WeakMap()");
    expect(source).toContain("function peerLifecycleAbortError()");
    expect(source).toContain("error.linguaPeerLifecycle = true");
    expect(source).toContain("function peerConnectionActive(pc");
    expect(source).toContain("generation !== browserRoomGeneration");
    expect(source).toContain("state?.pc === pc");
    expect(source).toContain("handle = async function lifecycleAwareRoomHandle");
    expect(source).toContain("error?.linguaPeerLifecycle === true || generation !== browserRoomGeneration");
    expect(source).toContain("send = function lifecycleAwareRoomSend");
    expect(source).toContain('message?.type === "signal"');
    expect(source).toContain("peerConnectionActive(state.pc)");
    expect(source).toContain('const guardedPeerMethods = ["setLocalDescription", "setRemoteDescription", "addIceCandidate"]');
    expect(source).toContain("pc[methodName] = async (...methodArgs) => {");
    expect(source).toContain('window.addEventListener("unhandledrejection", event => {');
    expect(source).toContain("event.reason?.linguaPeerLifecycle === true");
  });
});

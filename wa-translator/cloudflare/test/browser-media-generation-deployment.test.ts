import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser media lifecycle deployment", () => {
  it("serves generation-bound browser media acquisition and permanent teardown guards", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("let browserMediaGeneration = 0");
    expect(source).toContain("let browserMediaLifecycleEnded = false");
    expect(source).toContain("const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices)");
    expect(source).toContain("const generation = browserMediaGeneration");
    expect(source).toContain("generation !== browserMediaGeneration || !browserMediaRequestActive()");
    expect(source).toContain("stopCapturedBrowserStream(stream)");
    expect(source).toContain('"Media request superseded by room teardown", "AbortError"');
    expect(source).toContain("typeof leaving !== \"undefined\" && leaving");
    expect(source).toContain("typeof explicitLeave !== \"undefined\" && explicitLeave");
    expect(source).toContain("typeof terminalRoom !== \"undefined\" && terminalRoom");
    expect(source).toContain("disconnectRoom = function mediaAwareDisconnectRoom");
    expect(source).toContain("browserMediaLifecycleEnded = true");
    expect(source).toContain("invalidatePendingBrowserMedia()");
  });

  it("serves generation-owned media promises and camera completion guards", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("const browserMediaTasks = new Map()");
    expect(source).toContain("function lifecycleMediaTask(kind, roomGetter)");
    expect(source).toContain("current?.generation === generation");
    expect(source).toContain("browserMediaTasks.get(kind)?.task === task");
    expect(source).toContain("track.onended = event => {");
    expect(source).toContain("getAudioMedia = function lifecycleAwareGetAudioMedia");
    expect(source).toContain("getVideoMedia = function lifecycleAwareGetVideoMedia");
    expect(source).toContain("camButton.onclick = async () => {");
    expect(source).toContain('setStatus("status.cameraUnavailable", null, true)');
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser audio generation deployment", () => {
  it("serves generation guards for mic graph setup, raw PCM delivery, and shared fallback audio", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("let browserAudioStartPromise = null");
    expect(source).toContain("let browserAudioStartGeneration = -1");
    expect(source).toContain("function audioLifecycleAbortError()");
    expect(source).toContain("error.linguaAudioLifecycle = true");
    expect(source).toContain("startCapture = function lifecycleAwareStartCapture()");
    expect(source).toContain("browserAudioStartGeneration === browserRoomGeneration");
    expect(source).toContain("const stream = await getAudioMedia()");
    expect(source).toContain("let context = audioCtx");
    expect(source).toContain('await context.audioWorklet.addModule("/static/pcm-worklet.js")');
    expect(source).toContain("audioCtx !== context");
    expect(source).toContain("workletNode !== node");
    expect(source).toContain("ws.send(event.data)");
    expect(source).toContain("micButton.onclick = async () => {");
    expect(source).toContain("error?.linguaAudioLifecycle === true");
    expect(source).toContain("const roomFallbackPlay = fallbackAudio.play.bind(fallbackAudio)");
    expect(source).toContain("fallbackAudio.play = (...args) => {");
    expect(source).toContain("Promise.resolve(roomFallbackPlay(...args)).then(");
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("first-run host onboarding", () => {
  it("ships a local-only explainer before the host's first meaningful action", async () => {
    const dashboard = await exports.default.fetch(`${ORIGIN}/`);
    expect(dashboard.status).toBe(200);
    const html = await dashboard.text();

    expect(html).toContain('id="onboardingPanel"');
    expect(html).toContain('aria-labelledby="onboardingTitle" hidden');
    expect(html).toContain('data-i18n="auth.signInPrompt"');
    expect(html).toContain('data-i18n="tile.video"');
    expect(html).toContain('data-i18n="tile.voice"');
    expect(html).toContain('data-i18n="tile.chat"');
    expect(html).toContain('data-i18n="home.participantLink"');
    expect(html).toContain('data-i18n="home.share"');
    expect(html).toContain('data-i18n="gate.join"');

    const eventsTag = html.indexOf('<script src="/product-events.js" defer></script>');
    const onboardingTag = html.indexOf('<script src="/dashboard-onboarding.js" defer></script>');
    expect(eventsTag).toBeGreaterThanOrEqual(0);
    expect(onboardingTag).toBeGreaterThan(eventsTag);

    const onboardingResponse = await exports.default.fetch(`${ORIGIN}/dashboard-onboarding.js`);
    expect(onboardingResponse.status).toBe(200);
    const source = await onboardingResponse.text();
    expect(source).toContain('const STORAGE_KEY = "lingua-relay.onboarding.v1"');
    expect(source).toContain('localStorage.getItem(STORAGE_KEY) === "1"');
    expect(source).toContain('localStorage.setItem(STORAGE_KEY, "1")');
    expect(source).toContain('emit("onboarding.view")');
    expect(source).toContain('emit("onboarding.complete")');
    for (const id of [
      "signInGoogle", "signInApple", "signInFacebook",
      "createVoiceBtn", "createChatBtn", "createBtn",
    ]) expect(source).toContain(`"${id}"`);

    // First-run education is presentation/local state only. It must never ask
    // for media access, contact a backend, or acquire an identity itself.
    for (const forbidden of [
      "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket",
      "getUserMedia", "mediaDevices", "document.cookie",
    ]) expect(source).not.toContain(forbidden);

    const eventSource = await (await exports.default.fetch(`${ORIGIN}/product-events.js`)).text();
    expect(eventSource).toContain('"onboarding.view": new Set()');
    expect(eventSource).toContain('"onboarding.complete": new Set()');
  });
});

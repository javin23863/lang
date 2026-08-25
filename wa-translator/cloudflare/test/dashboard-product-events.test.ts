import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("dashboard product event adapter", () => {
  it("captures only coarse activation intent and auth state", async () => {
    const dashboard = await exports.default.fetch(`${ORIGIN}/`);
    expect(dashboard.status).toBe(200);
    const html = await dashboard.text();
    expect(html).toContain('<script src="/product-events.js" defer></script>');
    expect(html).toContain('<script src="/dashboard-product-events.js" defer></script>');

    const response = await exports.default.fetch(`${ORIGIN}/dashboard-product-events.js`);
    expect(response.status).toBe(200);
    const source = await response.text();

    for (const marker of [
      'createVoiceBtn: "voice"',
      'createChatBtn: "chat"',
      'createBtn: "video"',
      'copyBtn: "copy"',
      'shareBtn: "system"',
      'waBtn: "whatsapp"',
      'lineBtn: "line"',
      'qrBtn: "qr"',
      'events.emit("room.create.intent", {mode})',
      'events.emit("invite.share.intent", {method})',
      'events.emit("room.open.intent")',
      'events.emit("locale.change", {locale: target.value})',
      'events.emit("auth.state", {state, provider_count: providerCount})',
    ]) expect(source).toContain(marker);

    for (const forbidden of [
      "shareLink.value", "location.href", "roomId", "host_control", "accountName",
      "fetch(", "sendBeacon", "localStorage", "sessionStorage", "document.cookie",
    ]) expect(source).not.toContain(forbidden);
  });
});

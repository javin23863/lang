import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("dashboard design foundation", () => {
  it("serves shared semantic tokens before screen-specific styles", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    const tokens = html.indexOf('<link rel="stylesheet" href="/design-tokens.css">');
    const dashboard = html.indexOf('<link rel="stylesheet" href="/dashboard.css">');
    expect(tokens).toBeGreaterThan(-1);
    expect(dashboard).toBeGreaterThan(tokens);

    const tokenResponse = await exports.default.fetch(`${ORIGIN}/design-tokens.css`);
    expect(tokenResponse.status).toBe(200);
    const tokenSource = await tokenResponse.text();
    for (const marker of [
      "--surface-canvas:", "--surface-card:", "--text-primary:", "--brand-primary:",
      "--status-danger:", "--status-success:", "--focus-ring:", "--touch-target:48px",
      "@media (prefers-color-scheme:dark)",
    ]) expect(tokenSource).toContain(marker);
  });

  it("makes video the first and visually primary activation action", async () => {
    const html = await (await exports.default.fetch(`${ORIGIN}/`)).text();
    const video = html.indexOf('id="createBtn" class="tile tilePrimary"');
    const voice = html.indexOf('id="createVoiceBtn" class="tile"');
    const chat = html.indexOf('id="createChatBtn" class="tile"');
    expect(video).toBeGreaterThan(-1);
    expect(video).toBeLessThan(voice);
    expect(voice).toBeLessThan(chat);

    const css = await (await exports.default.fetch(`${ORIGIN}/dashboard.css`)).text();
    expect(css).toContain(".modeGrid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(210px,.8fr);grid-template-rows:repeat(2,minmax(86px,1fr));gap:10px}");
    expect(css).toContain(".tilePrimary{grid-column:1;grid-row:1/3;min-height:182px");
    expect(css).toContain("@media(max-width:560px){");
    expect(css).toContain(".modeGrid{grid-template-columns:1fr 1fr;grid-template-rows:auto auto}");
    expect(css).toContain(".tilePrimary{grid-column:1/-1;grid-row:auto;min-height:132px");
  });
});

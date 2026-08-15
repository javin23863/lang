import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("installed host dashboard client", () => {
  it("serves an accessible, no-store dashboard with create, share, copy, open, close, and persisted host-control affordances", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const html = await response.text();

    for (const id of [
      "roomState", "createBtn", "shareLink", "copyBtn", "shareBtn", "openBtn", "closeBtn"
    ]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<script src="/app-runtime.js"></script>');
    expect(html).toContain('fetch(runtime.apiUrl("/api/rooms")');
    expect(html).toContain('fetch(runtime.apiUrl("/api/room-control")');
    expect(html).toContain('fetch(runtime.apiUrl("/api/room-control/close")');
    expect(html).not.toContain('fetch("/api/capabilities"');
    expect(html).not.toContain('id="catalogSummary"');
    expect(html).not.toContain('Private multilingual rooms');
    expect(html).not.toContain('Conversations that keep their natural flow.');
    expect(html).not.toContain('Create a private video room, share its link');
    expect(html).not.toContain('Capability declarations never imply locale-specific ASR');
    // Each terminal state is carried as a dictionary key so the dashboard can
    // state it in the host's own language.
    expect(html).toContain("function clearCurrentRoom(state, key)");
    expect(html).toContain('clearCurrentRoom("expired", "home.controlLost")');
    expect(html).toContain('clearCurrentRoom("closed", "home.roomClosed")');
    expect(html).toContain('clearCurrentRoom("closed", "home.roomClosedLink")');
    expect(html).toContain('id="appLocaleSel"');
    expect(html).toContain("runtime.i18n.use($(\"appLocaleSel\").value)");
    const runtime = await (await exports.default.fetch(`${ORIGIN}/app-runtime.js`)).text();
    expect(runtime).toContain("localStorage");
    expect(runtime).toContain("navigator.share");
    expect(html).toContain("navigator.clipboard");
    expect(runtime).toContain('window.open("about:blank", "_blank")');
    expect(runtime).toContain("opened.opener = null");
    expect(html).toContain(".room[hidden]{display:none}");
    expect(html).toContain("@media(max-width:380px)");
    expect(html).not.toContain('action="/rooms"');
  });
});

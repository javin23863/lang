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
    expect(html).toContain("localStorage");
    expect(html).toContain("navigator.share");
    expect(html).toContain("navigator.clipboard");
    expect(html).toContain('fetch("/api/rooms"');
    expect(html).toContain('fetch("/api/room-control"');
    expect(html).toContain('fetch("/api/room-control/close"');
    expect(html).not.toContain('fetch("/api/capabilities"');
    expect(html).not.toContain('id="catalogSummary"');
    expect(html).not.toContain('Private multilingual rooms');
    expect(html).not.toContain('Conversations that keep their natural flow.');
    expect(html).not.toContain('Create a private video room, share its link');
    expect(html).not.toContain('Capability declarations never imply locale-specific ASR');
    expect(html).toContain("function clearCurrentRoom(state, message)");
    expect(html).toContain('clearCurrentRoom("expired", "This room has expired or is no longer controlled by this device.")');
    expect(html).toContain('clearCurrentRoom("closed", "This room is closed.")');
    expect(html).toContain('clearCurrentRoom("closed", "This room is closed. Its participant link no longer works.")');
    expect(html).toContain('window.open("about:blank", "_blank")');
    expect(html).toContain("opened.opener = null");
    expect(html).toContain("@media(max-width:380px)");
    expect(html).not.toContain('action="/rooms"');
  });
});

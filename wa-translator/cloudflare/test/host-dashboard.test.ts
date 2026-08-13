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
    expect(html).toContain('window.open("about:blank", "_blank")');
    expect(html).toContain("opened.opener = null");
    expect(html).toContain("@media(max-width:380px)");
    expect(html).not.toContain('action="/rooms"');
  });
});

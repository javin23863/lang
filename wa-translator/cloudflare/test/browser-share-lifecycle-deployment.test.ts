import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser share lifecycle deployment", () => {
  it("serves generation-bound invitation sharing and terminal retirement", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("function retireInvitationControls()");
    expect(source).toContain('const shareButton = document.getElementById("shareBtn")');
    expect(source).toContain("shareButton.onclick = async () =>");
    expect(source).toMatch(/await runtime\.share\(invite\)[\s\S]*?generation !== browserRoomGeneration/);
    expect(source).toMatch(/await navigator\.clipboard\.writeText\(invite\.url\)[\s\S]*?generation !== browserRoomGeneration/);
    expect(source).toContain("event.stopImmediatePropagation?.()");
    expect(source).toContain("retireInvitationControls();");
    expect(source).toContain("if (qrButton && !browserMediaLifecycleEnded) qrButton.disabled = false");
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("public capability catalog", () => {
  it("serves the shared catalog without caching or claiming locale-specific MT", async () => {
    const response = await exports.default.fetch("https://room.test/api/capabilities");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const catalog = await response.json<any>();
    expect(catalog.counts).toMatchObject({
      base_languages: 100,
      locale_profiles: expect.any(Number),
      live_speech_languages: 6,
    });
    expect(catalog.counts.locale_profiles).toBeGreaterThanOrEqual(117);
    expect(catalog.locales.find((entry: any) => entry.id === "es-MX")).toMatchObject({
      language: "es", asr_code: "es", mt_code: "es", dialect_quality_claim: false,
    });
  });
});

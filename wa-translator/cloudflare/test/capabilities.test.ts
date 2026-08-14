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
      model_speech_languages: 84,
      verified_speech_languages: 6,
      joinable_locale_profiles: 106,
      voice_languages: 6,
      voice_profiles: 13,
    });
    expect(catalog.counts.locale_profiles).toBeGreaterThanOrEqual(117);
    expect(catalog.locales.find((entry: any) => entry.id === "es-MX")).toMatchObject({
      language: "es", asr_code: "es", mt_code: "es", dialect_quality_claim: false,
    });
    expect(catalog.locales.find((entry: any) => entry.id === "pt-BR")).toMatchObject({
      language: "pt", capabilities: { asr: { available: true, tier: "preview" } },
    });
    expect(catalog.locales.find((entry: any) => entry.id === "jv-ID")).toMatchObject({
      language: "jv", asr_code: "jw", mt_code: "jv",
    });
    expect(catalog.locales.find((entry: any) => entry.id === "km-KH")).toMatchObject({
      language: "km", native_name: "ខ្មែរ (Cambodia)",
      capabilities: { asr: { available: true, tier: "preview" } },
    });
    expect(catalog.locales.find((entry: any) => entry.id === "ast-ES")).toMatchObject({
      capabilities: { asr: { available: false, tier: "unavailable" } },
    });
    expect(catalog.locales.find((entry: any) => entry.id === "hi-IN")).toMatchObject({
      voice_profiles: [{ id: "hi-hf-alpha" }, { id: "hi-hm-omega" }],
    });
    expect(catalog.locales.find((entry: any) => entry.id === "it-IT")).toMatchObject({
      voice_profiles: [{ id: "it-if-sara" }, { id: "it-im-nicola" }],
    });
    expect(catalog.locales.find((entry: any) => entry.id === "pt-BR")).toMatchObject({
      voice_profiles: [{ id: "pt-br-pf-dora" }, { id: "pt-br-pm-alex" }],
    });
  });
});

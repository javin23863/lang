import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("permanent deployment surface", () => {
  it("exposes health and the shared installable client assets", async () => {
    const health = await exports.default.fetch(`${ORIGIN}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("Cache-Control")).toBe("no-store");

    const manifest = await exports.default.fetch(`${ORIGIN}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(await manifest.json<any>()).toMatchObject({
      name: "Live Translator", short_name: "Translator", display: "standalone",
      start_url: "/", icons: [expect.objectContaining({ src: "/icon.svg" })]
    });

    const worklet = await exports.default.fetch(`${ORIGIN}/static/pcm-worklet.js`);
    expect(worklet.status).toBe(200);
    expect(await worklet.text()).toContain("AudioWorkletProcessor");

    const serviceWorker = await exports.default.fetch(`${ORIGIN}/sw.js`);
    expect(serviceWorker.status).toBe(200);
    expect(serviceWorker.headers.get("Service-Worker-Allowed")).toBe("/");
  });
});

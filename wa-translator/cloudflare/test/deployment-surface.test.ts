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
      name: "Lingua Relay", short_name: "Lingua Relay", display: "standalone",
      start_url: "/", scope: "/", background_color: "#F4FBF9", theme_color: "#075E54",
      icons: [expect.objectContaining({ src: "/icon.svg" })]
    });

    const dashboard = await exports.default.fetch(`${ORIGIN}/`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get("Content-Security-Policy"))
      .toBe("frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    expect(dashboard.headers.get("X-Frame-Options")).toBe("DENY");
    expect(dashboard.headers.get("Permissions-Policy")).toBe("camera=(), microphone=()");

    const room = await exports.default.fetch(`${ORIGIN}/room.html`);
    expect(room.status).toBe(200);
    expect(room.headers.get("Content-Security-Policy"))
      .toBe("frame-ancestors 'none'; base-uri 'none'; object-src 'none'; style-src 'self'; script-src 'self'");
    expect(room.headers.get("X-Frame-Options")).toBe("DENY");
    expect(room.headers.get("Permissions-Policy")).toBe("camera=(self), microphone=(self)");
    const roomHtml = await room.text();
    expect(roomHtml).toContain('<link rel="stylesheet" href="/room.css">');
    expect(roomHtml).toContain('<script src="/room.js"></script>');
    expect(roomHtml).not.toContain("<style>");
    expect(roomHtml).not.toContain("<script>\nconst $ =");
    expect(roomHtml).toContain('id="participantCount" aria-live="polite">0 / 2 people<');
    expect(roomHtml).not.toContain('id="participantCount" aria-live="polite">0 / 4 people<');

    const roomCss = await exports.default.fetch(`${ORIGIN}/room.css`);
    expect(roomCss.status).toBe(200);
    expect(roomCss.headers.get("Content-Type")).toContain("text/css");
    expect(roomCss.headers.get("Cache-Control")).toBe("no-store");
    expect(await roomCss.text()).toContain("#stage{");

    const roomJs = await exports.default.fetch(`${ORIGIN}/room.js`);
    expect(roomJs.status).toBe(200);
    expect(roomJs.headers.get("Content-Type")).toContain("text/javascript");
    expect(roomJs.headers.get("Cache-Control")).toBe("no-store");
    const roomJsSource = await roomJs.text();
    expect(roomJsSource).toContain("const $ = (id) => document.getElementById(id);");
    expect(roomJsSource).toContain("async function connect()");

    const worklet = await exports.default.fetch(`${ORIGIN}/static/pcm-worklet.js`);
    expect(worklet.status).toBe(200);
    expect(await worklet.text()).toContain("AudioWorkletProcessor");

    const dashboardCss = await exports.default.fetch(`${ORIGIN}/dashboard.css`);
    expect(dashboardCss.status).toBe(200);
    expect(await dashboardCss.text()).toContain(".page{");
    const dashboardJs = await exports.default.fetch(`${ORIGIN}/dashboard.js`);
    expect(dashboardJs.status).toBe(200);
    expect(await dashboardJs.text()).toContain("async function createRoom(mode)");

    // Both pages load the QR encoder as a plain asset, so a 404 here is a share
    // row whose code silently never draws.
    const qr = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(qr.status).toBe(200);
    expect(await qr.text()).toContain("LinguaQR");

    const serviceWorker = await exports.default.fetch(`${ORIGIN}/sw.js`);
    expect(serviceWorker.status).toBe(200);
    expect(serviceWorker.headers.get("Service-Worker-Allowed")).toBe("/");
    const serviceWorkerJs = await serviceWorker.text();
    expect(serviceWorkerJs).toContain("cache: 'no-store'");
    expect(serviceWorkerJs).not.toContain("caches.open");
    expect(serviceWorkerJs).not.toContain("cache.put");
  });
});

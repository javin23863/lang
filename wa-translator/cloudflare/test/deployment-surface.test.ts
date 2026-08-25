import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

function expectBaselineHeaders(response: Response): void {
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

describe("permanent deployment surface", () => {
  it("exposes health and the shared installable client assets", async () => {
    const health = await exports.default.fetch(`${ORIGIN}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("Cache-Control")).toBe("no-store");
    expectBaselineHeaders(health);

    const manifest = await exports.default.fetch(`${ORIGIN}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expectBaselineHeaders(manifest);
    expect(await manifest.json<any>()).toMatchObject({
      name: "Lingua Relay", short_name: "Lingua Relay", display: "standalone",
      start_url: "/", scope: "/", background_color: "#F4FBF9", theme_color: "#075E54",
      icons: [expect.objectContaining({ src: "/icon.svg" })]
    });

    const dashboard = await exports.default.fetch(`${ORIGIN}/`);
    expect(dashboard.status).toBe(200);
    expectBaselineHeaders(dashboard);
    expect(dashboard.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'"
    );
    expect(dashboard.headers.get("X-Frame-Options")).toBe("DENY");
    expect(dashboard.headers.get("Permissions-Policy")).toBe("camera=(), microphone=()");

    const room = await exports.default.fetch(`${ORIGIN}/room.html`);
    expect(room.status).toBe(200);
    expectBaselineHeaders(room);
    expect(room.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' wss://room.test; worker-src 'self'"
    );
    expect(room.headers.get("X-Frame-Options")).toBe("DENY");
    expect(room.headers.get("Permissions-Policy")).toBe("camera=(self), microphone=(self)");
    const roomHtml = await room.text();
    expect(roomHtml).toContain('<link rel="stylesheet" href="/room.css">');
    expect(roomHtml).toContain('<link rel="stylesheet" href="/room-ui.css">');
    expect(roomHtml).toContain('<script src="/room.js"></script>');
    expect(roomHtml).not.toContain("<style>");
    expect(roomHtml).not.toContain("<script>\nconst $ =");
    expect(roomHtml).toContain('id="status" role="status" aria-live="polite"');
    expect(roomHtml).toContain('id="captions" role="log" aria-live="polite" aria-relevant="additions text"');
    expect(roomHtml).toContain('id="participantCount" aria-live="polite">0 / 2 people<');
    expect(roomHtml).not.toContain('id="participantCount" aria-live="polite">0 / 4 people<');
    expect(roomHtml).toContain('<input id="termsAgree" type="checkbox">');
    expect(roomHtml).not.toContain('<input id="termsAgree" type="checkbox" checked>');

    const roomCss = await exports.default.fetch(`${ORIGIN}/room.css`);
    expect(roomCss.status).toBe(200);
    expectBaselineHeaders(roomCss);
    expect(roomCss.headers.get("Content-Type")).toContain("text/css");
    expect(roomCss.headers.get("Cache-Control")).toBe("no-store");
    expect(await roomCss.text()).toContain("#stage{");

    const roomUiCss = await exports.default.fetch(`${ORIGIN}/room-ui.css`);
    expect(roomUiCss.status).toBe(200);
    expectBaselineHeaders(roomUiCss);
    expect(roomUiCss.headers.get("Content-Type")).toContain("text/css");
    const roomUiSource = await roomUiCss.text();
    expect(roomUiSource).toContain("--accent:#64D4C3");
    expect(roomUiSource).toContain("prefers-reduced-motion:reduce");

    const roomJs = await exports.default.fetch(`${ORIGIN}/room.js`);
    expect(roomJs.status).toBe(200);
    expectBaselineHeaders(roomJs);
    expect(roomJs.headers.get("Content-Type")).toContain("text/javascript");
    expect(roomJs.headers.get("Cache-Control")).toBe("no-store");
    const roomJsSource = await roomJs.text();
    expect(roomJsSource).toContain("const $ = (id) => document.getElementById(id);");
    expect(roomJsSource).toContain("async function connect()");
    expect(roomJsSource).toContain("el.hidden = !text");
    expect(roomJsSource).not.toContain("el.style.display");
    expect(roomJsSource).toContain("const title = 'gate.title';");
    expect(roomJsSource).toContain("const join = 'gate.join';");
    expect(roomJsSource).toContain("setCallState('stage.waiting')");
    expect(roomJsSource).not.toContain("setCallState('call.ringing')");
    expect(roomJsSource).not.toContain("if (isHost) startRingback()");
    expect(roomJsSource).toMatch(/if \(roomMode === 'voice' && m\.peers\.length\) \{[\s\S]*?connectCall\(\)/);
    expect(roomJsSource).toMatch(/if \(roomMode === 'voice' && !callTimerStart\) \{[\s\S]*?to: m\.id[\s\S]*?connectCall\(\)/);
    expect(roomJsSource).toContain("const termsKey = 'lingua-relay.terms.2026-08-25';");
    expect(roomJsSource).not.toContain("lingua-relay.terms.2026-08-14");
    expect(roomJsSource).toContain("$('termsAgree').checked = localStorage.getItem(termsKey) === '1';");
    expect(roomJsSource).toContain("if (roleChosen || !termsAccepted()");

    const deleteAccount = await exports.default.fetch(`${ORIGIN}/delete-account.html`);
    expect(deleteAccount.status).toBe(200);
    expectBaselineHeaders(deleteAccount);
    const deleteAccountHtml = await deleteAccount.text();
    expect(deleteAccountHtml).toContain("Delete your Lingua Relay account");
    expect(deleteAccountHtml).toMatch(/do not need the mobile app/i);
    expect(deleteAccountHtml).toContain("Open Lingua Relay account controls");

    const worklet = await exports.default.fetch(`${ORIGIN}/static/pcm-worklet.js`);
    expect(worklet.status).toBe(200);
    expectBaselineHeaders(worklet);
    expect(await worklet.text()).toContain("AudioWorkletProcessor");

    const dashboardCss = await exports.default.fetch(`${ORIGIN}/dashboard.css`);
    expect(dashboardCss.status).toBe(200);
    expectBaselineHeaders(dashboardCss);
    expect(await dashboardCss.text()).toContain(".page{");

    const dashboardJs = await exports.default.fetch(`${ORIGIN}/dashboard.js`);
    expect(dashboardJs.status).toBe(200);
    expectBaselineHeaders(dashboardJs);
    expect(await dashboardJs.text()).toContain("window.LinguaDashboardRoomController.create");

    const dashboardRoomController = await exports.default.fetch(`${ORIGIN}/dashboard-room-controller.js`);
    expect(dashboardRoomController.status).toBe(200);
    expectBaselineHeaders(dashboardRoomController);
    const dashboardRoomControllerSource = await dashboardRoomController.text();
    expect(dashboardRoomControllerSource).toContain("async function createRoom(mode)");
    expect(dashboardRoomControllerSource).toContain("create: createRoom");

    // Both pages load the QR encoder as a plain asset, so a 404 here is a share
    // row whose code silently never draws.
    const qr = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(qr.status).toBe(200);
    expectBaselineHeaders(qr);
    expect(await qr.text()).toContain("LinguaQR");

    const serviceWorker = await exports.default.fetch(`${ORIGIN}/sw.js`);
    expect(serviceWorker.status).toBe(200);
    expectBaselineHeaders(serviceWorker);
    expect(serviceWorker.headers.get("Service-Worker-Allowed")).toBe("/");
    const serviceWorkerJs = await serviceWorker.text();
    expect(serviceWorkerJs).toContain("cache: 'no-store'");
    expect(serviceWorkerJs).toContain("const SHELL_PATHS = new Set([");
    const shellBlock = serviceWorkerJs.match(/const SHELL_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
    for (const path of ["'/'", "'/index.html'", "'/dashboard.css'", "'/product-events.js'", "'/manifest.webmanifest'"]) {
      expect(shellBlock).toContain(path);
    }
    for (const capabilityPath of ["/room.html", "/room/", "/ws/", "/api/", "/auth/", "/static/i18n/"]) {
      expect(shellBlock).not.toContain(capabilityPath);
    }
    for (const networkOnlyMarker of [
      "path === '/room.html'",
      "path.startsWith('/room/')",
      "path.startsWith('/ws/')",
      "path.startsWith('/api/')",
      "path.startsWith('/auth/')",
      "path.startsWith('/static/i18n/')",
      "if (request.method !== 'GET' || networkOnly(path))",
      "if (!SHELL_PATHS.has(path))",
    ]) expect(serviceWorkerJs).toContain(networkOnlyMarker);
    expect(serviceWorkerJs).toContain("const cache = await caches.open(CACHE_NAME)");
    expect(serviceWorkerJs).toContain("await cache.put(request, response.clone())");
    expect(serviceWorkerJs).toContain("const cached = await caches.match(request)");
  });

  it("never caches dynamic auth, API, or room errors", async () => {
    for (const request of [
      new Request(`${ORIGIN}/api/v1/not-a-real-route`),
      new Request(`${ORIGIN}/auth/not-a-provider/start`),
      new Request(`${ORIGIN}/room/not-a-room`),
      new Request(`${ORIGIN}/tts`, {method: "POST"}),
    ]) {
      const response = await exports.default.fetch(request);
      expect(response.ok).toBe(false);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expectBaselineHeaders(response);
    }
  });
});

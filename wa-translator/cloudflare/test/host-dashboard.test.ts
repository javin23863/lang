import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("installed host dashboard client", () => {
  it("serves an accessible, no-store dashboard with decomposed product boundaries", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const html = await response.text();
    const script = await (await exports.default.fetch(`${ORIGIN}/dashboard.js`)).text();
    const api = await (await exports.default.fetch(`${ORIGIN}/dashboard-api.js`)).text();
    const account = await (await exports.default.fetch(`${ORIGIN}/dashboard-account.js`)).text();
    const roomModel = await (await exports.default.fetch(`${ORIGIN}/dashboard-room-model.js`)).text();
    const roomController = await (await exports.default.fetch(`${ORIGIN}/dashboard-room-controller.js`)).text();
    const share = await (await exports.default.fetch(`${ORIGIN}/dashboard-share.js`)).text();
    const settings = await (await exports.default.fetch(`${ORIGIN}/dashboard-settings.js`)).text();
    const lifecycle = await (await exports.default.fetch(`${ORIGIN}/dashboard-lifecycle.js`)).text();
    const css = await (await exports.default.fetch(`${ORIGIN}/dashboard.css`)).text();

    for (const id of [
      "roomState", "createBtn", "shareLink", "copyBtn", "shareBtn", "openBtn", "closeBtn",
      "authPanel", "accountChip", "signOutBtn", "creditsPanel", "usageList", "deleteAccountBtn",
      "createVoiceBtn", "createChatBtn", "waBtn", "lineBtn", "qrBtn", "qrBox"
    ]) expect(html).toContain(`id="${id}"`);

    expect(html).not.toContain("data-stub");
    expect(html).not.toContain('id="buyCreditsBtn"');
    expect(html).not.toContain('id="creditsBalance"');
    expect(html).not.toContain('id="calleeName"');
    expect(roomModel).not.toContain('searchParams.set("n"');
    expect(roomModel).not.toContain("callee");

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<script src="/app-runtime.js"></script>');
    expect(html).toContain('<script src="/qr.js" defer></script>');
    expect(html).toContain('<link rel="stylesheet" href="/dashboard.css">');
    expect(html).toContain('<script src="/dashboard.js"></script>');
    const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');
    for (const asset of [
      "dashboard-api", "dashboard-account", "dashboard-room-model", "dashboard-room-controller",
      "dashboard-share", "dashboard-settings", "dashboard-lifecycle",
    ]) {
      const tag = `<script src="/${asset}.js"></script>`;
      expect(html).toContain(tag);
      expect(html.indexOf(tag)).toBeLessThan(dashboardTag);
    }
    expect(html).not.toContain("<style>");

    // Account/auth presentation owns account snapshots and provider rendering.
    expect(script).toContain("window.LinguaDashboardAccount.create");
    expect(script).toContain("accountPresenter.load()");
    expect(script).toContain("accountPresenter.render(account)");
    expect(script).not.toContain('dashboardFetch(runtime.apiUrl("/api/me")');
    expect(account).toContain('dashboardFetch(runtime.apiUrl("/api/me")');
    expect(account).toContain('"signInGoogle"');
    expect(account).toContain('"signInApple"');
    expect(account).toContain('"signInFacebook"');
    expect(account).toContain('/auth/" + provider + "/start');
    expect(account).toContain('document.body.dataset.auth = account.signed_in ? "in" : "out"');
    expect(account).not.toContain("new AbortController()");

    // Capability URL normalization and persistence are isolated from network
    // room control so either side can evolve without reimplementing the other.
    expect(script).toContain("window.LinguaDashboardRoomModel.create(runtime)");
    expect(roomModel).toContain('new Set(["voice", "chat", "video"])');
    expect(roomModel).toContain('url.searchParams.set("m", selected)');
    expect(roomModel).toContain('typeof value.path !== "string"');
    expect(roomModel).toContain('typeof value.host_control !== "string"');
    expect(roomModel).toContain("Number.isSafeInteger(value.expires_at)");
    expect(roomModel).toContain("ROOM_PATH_PATTERN.exec(value.path)");
    expect(roomModel).toContain("HOST_CONTROL_PATTERN.exec(value.host_control)");
    expect(roomModel).toContain("room[1] === control[1] && room[2] === control[2] && room[2] === expires");
    expect(roomModel).toContain("runtime.loadHostRoom()");
    expect(roomModel).toContain("runtime.saveHostRoom(JSON.stringify(room))");
    expect(roomModel).toContain("runtime.forgetHostRoom()");

    // Room creation/control owns polling, authenticated control requests, room
    // lifecycle, and operation-result telemetry. Dashboard only binds controls.
    expect(script).toContain("window.LinguaDashboardRoomController.create");
    expect(script).toContain('$("createBtn").onclick = () => roomController.create("video")');
    expect(script).toContain('$("openBtn").onclick = roomController.open');
    expect(script).toContain('$("closeBtn").onclick = () => roomController.close(true)');
    expect(script).not.toContain('dashboardFetch(runtime.apiUrl("/api/rooms")');
    expect(script).not.toContain('dashboardFetch(runtime.apiUrl("/api/room-control")');
    expect(roomController).toContain('dashboardFetch(runtime.apiUrl("/api/rooms")');
    expect(roomController).toContain('dashboardFetch(runtime.apiUrl("/api/room-control")');
    expect(roomController).toContain('dashboardFetch(runtime.apiUrl("/api/room-control/close")');
    expect(roomController).toContain("let statusRefreshRoom = null");
    expect(roomController).toContain("const targetRoom = room");
    expect(roomController).toContain("if (!targetRoom || busy || statusRefreshRoom === targetRoom) return");
    expect(roomController).toContain("statusRefreshRoom = targetRoom");
    expect(roomController).toContain("if (room !== targetRoom) return");
    expect(roomController).toContain("if (room === targetRoom)");
    expect(roomController).toContain("if (statusRefreshRoom === targetRoom) statusRefreshRoom = null");
    expect(roomController).toContain("value.participant_limit !== 2");
    expect(roomController).toContain('events()?.emit("room.create.result", {mode: requestedMode, result: "success"})');
    expect(roomController).toContain('events()?.emit("room.create.result", {mode: requestedMode, result: "failure"})');
    expect(roomController).toContain('events()?.emit("room.close.result", {result: "success"})');
    expect(roomController).toContain('events()?.emit("room.close.result", {result: "failure"})');
    expect(roomController).toContain("const requestedMode = model.normalizeMode(mode)");
    expect(roomController).toContain("created.mode = requestedMode");
    expect(roomController).toContain("runtime.openRoom(room.path, model.mode(room))");
    expect(roomController).toContain('clear("expired", "home.controlLost")');
    expect(roomController).toContain('clear("closed", "home.roomClosed")');
    expect(roomController).toContain('clear("closed", "home.roomClosedLink")');

    // Invite copying, system sharing, app handoff, and QR rendering are one
    // feature boundary. The coordinator only wires controls to that presenter.
    expect(script).toContain("window.LinguaDashboardShare.create");
    expect(script).toContain('$("copyBtn").onclick = sharePresenter.copy');
    expect(script).toContain('$("shareBtn").onclick = sharePresenter.systemShare');
    expect(script).toContain('$("waBtn").onclick = sharePresenter.whatsapp');
    expect(script).toContain('$("lineBtn").onclick = sharePresenter.line');
    expect(script).toContain('$("qrBtn").onclick = sharePresenter.toggleQr');
    expect(script).not.toContain("https://wa.me/?text=");
    expect(script).not.toContain("navigator.clipboard");
    expect(share).toContain("https://wa.me/?text=");
    expect(share).toContain("https://line.me/R/share?text=");
    expect(share).not.toContain("social-plugins.line.me");
    expect(share).toContain("navigator.clipboard");
    expect(share).toContain("window.LinguaQR.svg(roomUrl(room))");

    // Language selection and page lifecycle are also isolated from feature
    // orchestration while preserving runtime behavior.
    expect(script).toContain("window.LinguaDashboardSettings.create");
    expect(script).toContain("settingsPresenter.install");
    expect(script).not.toContain("new Intl.DisplayNames");
    expect(settings).toContain("new Intl.DisplayNames");
    expect(settings).toContain('runtime.i18n.use(byId("appLocaleSel").value)');
    expect(settings).toContain("runtime.i18n.onChange");
    expect(script).toContain("window.LinguaDashboardLifecycle.create");
    expect(script).toContain("lifecycle.install()");
    expect(script).toContain("await lifecycle.ready()");
    expect(script).not.toContain('navigator.serviceWorker.register("/sw.js")');
    expect(lifecycle).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(lifecycle).toContain('document.addEventListener("visibilitychange"');
    expect(lifecycle).toContain('document.visibilityState === "visible"');

    // Request deadlines remain one shared API boundary.
    expect(script).toContain("const dashboardFetch = window.LinguaDashboardApi.fetch");
    expect(script).not.toContain("new AbortController()");
    expect(api).toContain("const REQUEST_TIMEOUT_MS = 15_000");
    expect(api).toContain("const controller = new AbortController()");
    expect(api).toContain("setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)");
    expect(api).toContain("clearTimeout(timer)");
    expect(api).toContain("Object.defineProperty(window, \"LinguaDashboardApi\"");
    expect(api).not.toContain("localStorage");
    expect(api).not.toContain("sessionStorage");

    expect(css).toContain("[data-auth=");
    for (const rule of css.match(/(?<=[\n;}])#(authPanel|accountChip|creditsPanel|roomPanel)\{[^}]*\}/g) ?? []) {
      expect(rule).not.toContain("display:");
    }
    expect(css).toContain('body[data-auth="in"] #accountChip{display:flex}');

    expect(html).not.toContain("password");
    expect(script).not.toContain("password");
    expect(account).not.toContain("password");
    expect(html).not.toContain('type="password"');
    expect(script).toContain("participantCount <= 2");
    expect(script).not.toContain('fetch("/api/capabilities"');
    expect(html).not.toContain('id="catalogSummary"');
    expect(html).not.toContain('Private multilingual rooms');
    expect(html).not.toContain('Conversations that keep their natural flow.');
    expect(html).not.toContain('Create a private video room, share its link');
    expect(html).not.toContain('Capability declarations never imply locale-specific ASR');

    // Logout/account deletion revoke their local room administration state.
    expect(script).toMatch(/deleteAccount\(\)[\s\S]*?if \(!response\.ok\)[\s\S]*?await roomController\.discard\(\);\s*location\.reload\(\)/);
    expect(script).toMatch(/signOutBtn[\s\S]*?if \(!response\.ok\) throw new Error\("logout failed"\);[\s\S]*?await roomController\.discard\(\);\s*location\.reload\(\)/);
    expect(script).toContain('setAuthStatus("auth.signOutFailed")');

    expect(html).toContain('id="appLocaleSel"');
    const runtime = await (await exports.default.fetch(`${ORIGIN}/app-runtime.js`)).text();
    expect(runtime).toContain("localStorage");
    expect(runtime).toContain("navigator.share");
    expect(runtime).toContain('"auth.signOutFailed": "Could not sign out. Try again."');
    expect(runtime).toContain('window.open("about:blank", "_blank")');
    expect(runtime).toContain("opened.opener = null");
    expect(css).toContain(".room[hidden]{display:none}");
    expect(css).toContain("@media(max-width:360px)");
    expect(html).not.toContain('action="/rooms"');
  });
});

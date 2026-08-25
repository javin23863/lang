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
    const script = await (await exports.default.fetch(`${ORIGIN}/dashboard.js`)).text();
    const api = await (await exports.default.fetch(`${ORIGIN}/dashboard-api.js`)).text();
    const account = await (await exports.default.fetch(`${ORIGIN}/dashboard-account.js`)).text();
    const roomModel = await (await exports.default.fetch(`${ORIGIN}/dashboard-room-model.js`)).text();
    const share = await (await exports.default.fetch(`${ORIGIN}/dashboard-share.js`)).text();
    const css = await (await exports.default.fetch(`${ORIGIN}/dashboard.css`)).text();

    for (const id of [
      "roomState", "createBtn", "shareLink", "copyBtn", "shareBtn", "openBtn", "closeBtn",
      "authPanel", "accountChip", "signOutBtn", "creditsPanel", "usageList", "deleteAccountBtn",
      "createVoiceBtn", "createChatBtn", "waBtn", "lineBtn", "qrBtn", "qrBox"
    ]) expect(html).toContain(`id="${id}"`);

    expect(html).not.toContain("data-stub");
    expect(html).not.toContain('id="buyCreditsBtn"');
    expect(html).not.toContain('id="creditsBalance"');
    expect(script).not.toContain("creditsBalance");
    expect(html).not.toContain('id="calleeName"');
    expect(roomModel).not.toContain('searchParams.set("n"');
    expect(roomModel).not.toContain("callee");
    expect(script).toContain("runtime.openRoom(currentRoom.path, roomMode(currentRoom))");

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<script src="/app-runtime.js"></script>');
    expect(html).toContain('<script src="/dashboard-api.js"></script>');
    expect(html).toContain('<script src="/dashboard-account.js"></script>');
    expect(html).toContain('<script src="/dashboard-room-model.js"></script>');
    expect(html).toContain('<script src="/dashboard-share.js"></script>');
    expect(html).toContain('<script src="/qr.js" defer></script>');
    expect(html).toContain('<link rel="stylesheet" href="/dashboard.css">');
    expect(html).toContain('<script src="/dashboard.js"></script>');
    const dashboardTag = html.indexOf('<script src="/dashboard.js"></script>');
    for (const asset of ["dashboard-api", "dashboard-account", "dashboard-room-model", "dashboard-share"]) {
      expect(html.indexOf(`<script src="/${asset}.js"></script>`)).toBeLessThan(dashboardTag);
    }
    expect(html).not.toContain("<style>");

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

    expect(script).toContain("window.LinguaDashboardRoomModel.create(runtime)");
    expect(script).toContain("roomModel.inviteUrl(room)");
    expect(script).toContain("roomModel.valid(value)");
    expect(script).toContain("roomModel.load()");
    expect(script).toContain("roomModel.save(room)");
    expect(script).toContain("roomModel.forget()");
    expect(roomModel).toContain('new Set(["voice", "chat", "video"])');
    expect(roomModel).toContain('url.searchParams.set("m", selected)');
    expect(roomModel).toContain('typeof value.host_control === "string"');
    expect(roomModel).toContain("Number.isSafeInteger(value.expires_at)");

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

    expect(script).toContain('dashboardFetch(runtime.apiUrl("/api/rooms")');
    expect(script).toContain('dashboardFetch(runtime.apiUrl("/api/room-control")');
    expect(script).toContain('dashboardFetch(runtime.apiUrl("/api/room-control/close")');

    expect(script).toContain("const dashboardFetch = window.LinguaDashboardApi.fetch");
    expect(script).not.toContain("new AbortController()");
    expect(api).toContain("const REQUEST_TIMEOUT_MS = 15_000");
    expect(api).toContain("const controller = new AbortController()");
    expect(api).toContain("setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)");
    expect(api).toContain("clearTimeout(timer)");
    expect(api).toContain("Object.defineProperty(window, \"LinguaDashboardApi\"");
    expect(api).not.toContain("localStorage");
    expect(api).not.toContain("sessionStorage");

    expect(script).toContain("let statusRefreshing = false");
    expect(script).toContain("if (!currentRoom || busy || statusRefreshing) return");
    expect(script).toContain("statusRefreshing = true");
    expect(script).toMatch(/finally \{\s*statusRefreshing = false/);

    expect(script).toContain('emit("room.create.result", {mode: requestedMode, result: "success"})');
    expect(script).toContain('emit("room.create.result", {mode: requestedMode, result: "failure"})');
    expect(script).toContain('emit("room.close.result", {result: "success"})');
    expect(script).toContain('emit("room.close.result", {result: "failure"})');

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
    expect(script).toContain("value.participant_limit !== 2");
    expect(script).not.toContain('fetch("/api/capabilities"');
    expect(html).not.toContain('id="catalogSummary"');
    expect(html).not.toContain('Private multilingual rooms');
    expect(html).not.toContain('Conversations that keep their natural flow.');
    expect(html).not.toContain('Create a private video room, share its link');
    expect(html).not.toContain('Capability declarations never imply locale-specific ASR');

    expect(script).toContain("function clearCurrentRoom(state, key)");
    expect(script).toContain('clearCurrentRoom("expired", "home.controlLost")');
    expect(script).toContain('clearCurrentRoom("closed", "home.roomClosed")');
    expect(script).toContain('clearCurrentRoom("closed", "home.roomClosedLink")');
    expect(script).toMatch(/deleteAccount\(\)[\s\S]*?if \(!response\.ok\)[\s\S]*?await forgetRoom\(\);\s*location\.reload\(\)/);
    expect(script).toMatch(/signOutBtn[\s\S]*?if \(!response\.ok\) throw new Error\("logout failed"\);[\s\S]*?await forgetRoom\(\);\s*location\.reload\(\)/);
    expect(script).toContain('setAuthStatus("auth.signOutFailed")');

    expect(script).toContain("const requestedMode = roomModel.normalizeMode(mode)");
    expect(script).toContain("room.mode = requestedMode");
    expect(html).toContain('id="appLocaleSel"');
    expect(script).toContain("runtime.i18n.use($(\"appLocaleSel\").value)");
    const runtime = await (await exports.default.fetch(`${ORIGIN}/app-runtime.js`)).text();
    expect(runtime).toContain("localStorage");
    expect(runtime).toContain("navigator.share");
    expect(runtime).toContain('"auth.signOutFailed": "Could not sign out. Try again."');
    expect(runtime).toContain('window.open("about:blank", "_blank")');
    expect(runtime).toContain("opened.opener = null");
    expect(css).toContain(".room[hidden]{display:none}");
    expect(css).toContain("@media(max-width:380px)");
    expect(html).not.toContain('action="/rooms"');
  });
});

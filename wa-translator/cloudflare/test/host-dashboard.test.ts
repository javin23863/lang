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
    const scriptResponse = await exports.default.fetch(`${ORIGIN}/dashboard.js`);
    expect(scriptResponse.status).toBe(200);
    const script = await scriptResponse.text();
    const cssResponse = await exports.default.fetch(`${ORIGIN}/dashboard.css`);
    expect(cssResponse.status).toBe(200);
    const css = await cssResponse.text();

    for (const id of [
      "roomState", "createBtn", "shareLink", "copyBtn", "shareBtn", "openBtn", "closeBtn",
      // Accounts: the sign-in card, the account chip, and the credits panel.
      "authPanel", "accountChip", "signOutBtn", "creditsPanel", "creditsBalance",
      "buyCreditsBtn", "usageList", "deleteAccountBtn",
      // The three call surfaces. createBtn above is the video tile, unchanged.
      "createVoiceBtn", "createChatBtn",
      // Sharing the invite: two apps by URL scheme, and a code for the ones
      // that have none.
      "waBtn", "lineBtn", "qrBtn", "qrBox"
    ]) expect(html).toContain(`id="${id}"`);
    // Provider buttons are rendered from /api/me, so the provider ids belong to
    // dashboard behavior rather than the markup shell.
    expect(script).toContain('"signInGoogle"');
    expect(script).toContain('"signInApple"');
    expect(script).toContain('"signInFacebook"');
    // Purchase is a stub and says so: a live-looking dead button is a store
    // review finding, and an enabled one would take money for nothing.
    expect(html).toContain("data-stub");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<script src="/app-runtime.js"></script>');
    expect(html).toContain('<script src="/qr.js" defer></script>');
    expect(html).toContain('<link rel="stylesheet" href="/dashboard.css">');
    expect(html).toContain('<script src="/dashboard.js"></script>');
    expect(html).not.toContain("<style>");
    expect(script).toContain("https://wa.me/?text=");
    // The /R/share form carries the sentence with the link; the social-plugins
    // form takes a url alone and drops it.
    expect(script).toContain("https://line.me/R/share?text=");
    expect(script).not.toContain("social-plugins.line.me");
    // The link inside the code is the bearer token that opens the room, so it
    // is drawn on the tap that asks for it and nowhere else.
    expect(script).toContain("window.LinguaQR.svg(roomUrl(currentRoom))");
    expect(script).toContain('fetch(runtime.apiUrl("/api/rooms")');
    expect(script).toContain('fetch(runtime.apiUrl("/api/me")');
    // Signed-in and signed-out are one attribute on <body>; nothing about the
    // account is decided by hiding elements one at a time.
    expect(css).toContain("[data-auth=");
    expect(script).toContain('document.body.dataset.auth = account.signed_in ? "in" : "out"');
    // An id selector carrying `display` outranks that one attribute, and the
    // element it names can then never be hidden: every bare id rule for an
    // auth-gated section must leave display to the state selectors.
    for (const rule of css.match(/(?<=[\n;}])#(authPanel|accountChip|creditsPanel|roomPanel)\{[^}]*\}/g) ?? []) {
      expect(rule).not.toContain("display:");
    }
    expect(css).toContain('body[data-auth="in"] #accountChip{display:flex}');
    // Sign-in is a link to the provider. This app never holds a password.
    expect(script).toContain('/auth/" + provider + "/start');
    expect(html).not.toContain("password");
    expect(script).not.toContain("password");
    expect(html).not.toContain('type="password"');
    expect(script).toContain('fetch(runtime.apiUrl("/api/room-control")');
    expect(script).toContain('fetch(runtime.apiUrl("/api/room-control/close")');
    expect(script).not.toContain('fetch("/api/capabilities"');
    expect(html).not.toContain('id="catalogSummary"');
    expect(html).not.toContain('Private multilingual rooms');
    expect(html).not.toContain('Conversations that keep their natural flow.');
    expect(html).not.toContain('Create a private video room, share its link');
    expect(html).not.toContain('Capability declarations never imply locale-specific ASR');
    // Each terminal state is carried as a dictionary key so the dashboard can
    // state it in the host's own language.
    expect(script).toContain("function clearCurrentRoom(state, key)");
    expect(script).toContain('clearCurrentRoom("expired", "home.controlLost")');
    expect(script).toContain('clearCurrentRoom("closed", "home.roomClosed")');
    expect(script).toContain('clearCurrentRoom("closed", "home.roomClosedLink")');
    // The mode rides the link, never the signed token: the worker is indifferent
    // to it and a video link stays exactly what it was.
    expect(script).toContain('url.searchParams.set("m", mode)');
    expect(script).toContain('room.mode = MODES.has(mode) ? mode : "video"');
    expect(html).toContain('id="appLocaleSel"');
    expect(script).toContain("runtime.i18n.use($(\"appLocaleSel\").value)");
    const runtime = await (await exports.default.fetch(`${ORIGIN}/app-runtime.js`)).text();
    expect(runtime).toContain("localStorage");
    expect(runtime).toContain("navigator.share");
    expect(script).toContain("navigator.clipboard");
    expect(runtime).toContain('window.open("about:blank", "_blank")');
    expect(runtime).toContain("opened.opener = null");
    expect(css).toContain(".room[hidden]{display:none}");
    expect(css).toContain("@media(max-width:380px)");
    expect(html).not.toContain('action="/rooms"');
  });
});

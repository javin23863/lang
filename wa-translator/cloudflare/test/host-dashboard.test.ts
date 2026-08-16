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
    // The provider buttons are rendered from what /api/me reports, so their ids
    // are in the source as the strings the page assigns rather than as markup.
    expect(html).toContain('"signInGoogle"');
    expect(html).toContain('"signInApple"');
    expect(html).toContain('"signInFacebook"');
    // Purchase is a stub and says so: a live-looking dead button is a store
    // review finding, and an enabled one would take money for nothing.
    expect(html).toContain("data-stub");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<script src="/app-runtime.js"></script>');
    expect(html).toContain('<script src="/qr.js" defer></script>');
    expect(html).toContain("https://wa.me/?text=");
    // The /R/share form carries the sentence with the link; the social-plugins
    // form takes a url alone and drops it.
    expect(html).toContain("https://line.me/R/share?text=");
    expect(html).not.toContain("social-plugins.line.me");
    // The link inside the code is the bearer token that opens the room, so it
    // is drawn on the tap that asks for it and nowhere else.
    expect(html).toContain("window.LinguaQR.svg(roomUrl(currentRoom))");
    expect(html).toContain('fetch(runtime.apiUrl("/api/rooms")');
    expect(html).toContain('fetch(runtime.apiUrl("/api/me")');
    // Signed-in and signed-out are one attribute on <body>; nothing about the
    // account is decided by hiding elements one at a time.
    expect(html).toContain("[data-auth=");
    expect(html).toContain('document.body.dataset.auth = account.signed_in ? "in" : "out"');
    // Sign-in is a link to the provider. This app never holds a credential.
    expect(html).toContain('/auth/" + provider + "/start');
    expect(html).not.toContain("password");
    expect(html).not.toContain('type="password"');
    expect(html).toContain('fetch(runtime.apiUrl("/api/room-control")');
    expect(html).toContain('fetch(runtime.apiUrl("/api/room-control/close")');
    expect(html).not.toContain('fetch("/api/capabilities"');
    expect(html).not.toContain('id="catalogSummary"');
    expect(html).not.toContain('Private multilingual rooms');
    expect(html).not.toContain('Conversations that keep their natural flow.');
    expect(html).not.toContain('Create a private video room, share its link');
    expect(html).not.toContain('Capability declarations never imply locale-specific ASR');
    // Each terminal state is carried as a dictionary key so the dashboard can
    // state it in the host's own language.
    expect(html).toContain("function clearCurrentRoom(state, key)");
    expect(html).toContain('clearCurrentRoom("expired", "home.controlLost")');
    expect(html).toContain('clearCurrentRoom("closed", "home.roomClosed")');
    expect(html).toContain('clearCurrentRoom("closed", "home.roomClosedLink")');
    // The mode rides the link, never the signed token: the worker is indifferent
    // to it and a video link stays exactly what it was.
    expect(html).toContain('url.searchParams.set("m", mode)');
    expect(html).toContain('room.mode = MODES.has(mode) ? mode : "video"');
    expect(html).toContain('id="appLocaleSel"');
    expect(html).toContain("runtime.i18n.use($(\"appLocaleSel\").value)");
    const runtime = await (await exports.default.fetch(`${ORIGIN}/app-runtime.js`)).text();
    expect(runtime).toContain("localStorage");
    expect(runtime).toContain("navigator.share");
    expect(html).toContain("navigator.clipboard");
    expect(runtime).toContain('window.open("about:blank", "_blank")');
    expect(runtime).toContain("opened.opener = null");
    expect(html).toContain(".room[hidden]{display:none}");
    expect(html).toContain("@media(max-width:380px)");
    expect(html).not.toContain('action="/rooms"');
  });
});

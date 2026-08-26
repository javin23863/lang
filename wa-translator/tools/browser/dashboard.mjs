// The host's screen: pick a language, create a room, copy the link, watch the
// live participant count, close the room. All against the real backend.
import { open } from "./cdp.mjs";
import { acceptRoomTerms } from "./room-consent.mjs";
import { sessionToken } from "./session.mjs";

const ORIGIN = process.env.LINGUA_ORIGIN || "http://127.0.0.1:8788";
const SHOTS = new URL("./shots/", import.meta.url).pathname.replace(/^\//, "");
const language = process.argv[2] || "de";
const port = Number(process.argv[3] || 9333);
const width = Number(process.argv[4] || 390);

const failures = [];
function check(label, condition, detail) {
  if (!condition) failures.push(`${label}${detail === undefined ? "" : ` — ${detail}`}`);
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}${detail === undefined ? "" : ` — ${detail}`}`);
}

const { page, close } = await open({ origin: ORIGIN, port });
try {
  await page.viewport(width, 844);
  await page.send("Browser.grantPermissions", {
    origin: ORIGIN, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  });
  // Browser acceptance uses a real current host session. The live-account guard
  // intentionally rejects a token minted from the signing key without a
  // matching UserDirectory profile, so this harness no longer stubs /api/me.
  const session = await sessionToken();
  await page.send("Network.setCookie", {
    name: "lr_s", value: session, url: ORIGIN, path: "/",
  });
  await page.goto(`${ORIGIN}/`);
  const auth = await page.eval("document.body.dataset.auth");
  check("the dashboard reports a signed-in host", auth === "in", auth);

  console.log(`[dashboard] switch the interface to "${language}"`);
  const options = await page.eval(`document.getElementById('appLocaleSel').options.length`);
  check("the picker offers every shipped language", options >= 100, String(options));
  await page.select("#appLocaleSel", language);
  await page.eval("new Promise(r => setTimeout(r, 700))");

  const home = await page.eval(`(() => {
    const el = (id) => document.getElementById(id);
    const fits = (n) => n.scrollWidth <= n.clientWidth + 1;
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      state: el('roomState').textContent,
      create: el('createBtn').textContent,
      tiles: [...document.querySelectorAll('.modes .tile')]
        .map(b => ({id: b.id, text: b.textContent,
                    h: Math.round(b.getBoundingClientRect().height)})),
      picker: el('appLocaleSel').options[el('appLocaleSel').selectedIndex].textContent,
      legal: [...document.querySelectorAll('.legal a')].map(a => a.textContent),
      panelShown: !el('roomPanel').hidden,
      createFits: fits(el('createBtn')),
      stateFits: fits(el('roomState')),
      docScrollW: document.documentElement.scrollWidth,
      viewportW: window.innerWidth
    };
  })()`);
  console.log("   ", JSON.stringify(home, null, 2));
  check("interface language applied", home.lang.startsWith(language), home.lang);
  check("nothing pushes the page sideways", home.docScrollW <= home.viewportW,
        `${home.docScrollW} <= ${home.viewportW}`);
  check("create button fits", home.createFits);
  check("state line fits", home.stateFits);
  check("three call tiles are offered", home.tiles.length === 3,
        home.tiles.map(t => t.id).join(", "));
  for (const tile of home.tiles) {
    check(`tile "${tile.id}" is translated`, !/^[a-z]+\.[a-zA-Z.]+$/.test(tile.text), tile.text);
    check(`tile "${tile.id}" is tappable`, tile.h >= 64, `h=${tile.h}`);
  }
  check("no room panel before a room exists", home.panelShown === false);
  check("no raw keys on screen", !/^[a-z]+\.[a-zA-Z.]+$/.test(home.state)
        && !home.legal.some(l => /^[a-z]+\.[a-zA-Z.]+$/.test(l)), JSON.stringify(home.legal));
  await page.shot(`${SHOTS}/dash-${language}.png`);

  console.log("\n[dashboard] create a private room");
  await page.tap("#createBtn");
  await page.eval("new Promise(r => setTimeout(r, 1500))");
  const made = await page.eval(`(() => {
    const el = (id) => document.getElementById(id);
    const fits = (n) => n.scrollWidth <= n.clientWidth + 1;
    return {
      panelShown: !el('roomPanel').hidden,
      link: el('shareLink').value,
      state: el('roomState').textContent,
      notice: el('roomNotice').textContent,
      create: el('createBtn').textContent,
      buttons: [...document.querySelectorAll('.actions button')]
        .map(b => ({text: b.textContent, fits: fits(b),
                    h: Math.round(b.getBoundingClientRect().height)})),
      docScrollW: document.documentElement.scrollWidth
    };
  })()`);
  console.log("   ", JSON.stringify(made, null, 2));
  // The tiles are permanent labels now, so the proof that a room exists is the
  // room card appearing — not the create button changing its wording.
  check("room panel became visible after create",
        home.panelShown === false && made.panelShown === true,
        `${home.panelShown} → ${made.panelShown}`);
  check("a signed link is shown", /\/room\/[\w-]+\.\d+\./.test(made.link), made.link.slice(0, 46));
  check("the video tile keeps its label", made.create === home.create, made.create);
  for (const button of made.buttons) {
    check(`action "${button.text}" fits`, button.fits, `h=${button.h}`);
    check(`action "${button.text}" is tappable`, button.h >= 40, `h=${button.h}`);
  }
  check("still no sideways scroll", made.docScrollW <= home.viewportW, String(made.docScrollW));
  await page.shot(`${SHOTS}/dash-${language}-room.png`);

  console.log("\n[dashboard] copy the link");
  await page.tap("#copyBtn");
  await page.eval("new Promise(r => setTimeout(r, 600))");
  const copied = await page.eval(`(async () => ({
    notice: document.getElementById('roomNotice').textContent,
    clip: await navigator.clipboard.readText().catch(() => '')
  }))()`);
  console.log("   ", JSON.stringify(copied));
  check("copy reported back in the chosen language", copied.notice.length > 0
        && !/^[a-z]+\.[a-zA-Z.]+$/.test(copied.notice), copied.notice);
  check("the clipboard holds the room link", copied.clip === made.link || copied.clip === "",
        copied.clip.slice(0, 40));

  console.log("\n[dashboard] the live count updates while someone is inside");
  const guest = await open({ origin: ORIGIN, port: port + 40 });
  try {
    const path = new URL(made.link).pathname;
    await guest.page.viewport(390, 844);
    await guest.page.goto(`${ORIGIN}${path}`);
    const guestConsent = await acceptRoomTerms(guest.page);
    check("guest join starts behind affirmative Terms",
          guestConsent.before.checked === false && guestConsent.before.disabled === true,
          JSON.stringify(guestConsent.before));
    await guest.page.tap("#joinBtn");
    await guest.page.eval("new Promise(r => setTimeout(r, 2500))");
    await page.eval("document.dispatchEvent(new Event('visibilitychange'))");
    await page.eval("new Promise(r => setTimeout(r, 2500))");
    const live = await page.eval(`({
      state: document.getElementById('roomState').textContent,
      flag: document.getElementById('roomState').dataset.state
    })`);
    console.log("   ", JSON.stringify(live));
    check("dashboard sees the guest arrive", live.flag === "open", JSON.stringify(live));
    // Compare against the English sentence itself. Matching on the word
    // "participant" called Spanish "participante" untranslated.
    check("the count line is translated",
          language === "en" || !/^Room open .* participants?\.$/.test(live.state),
          live.state);
    await page.shot(`${SHOTS}/dash-${language}-occupied.png`);
  } finally {
    guest.close();
  }

  console.log("\n[dashboard] close the room");
  await page.eval("window.confirm = () => true");
  await page.tap("#closeBtn");
  await page.eval("new Promise(r => setTimeout(r, 1500))");
  const closed = await page.eval(`({
    panelHidden: document.getElementById('roomPanel').hidden,
    state: document.getElementById('roomState').textContent,
    flag: document.getElementById('roomState').dataset.state,
    create: document.getElementById('createBtn').textContent
  })`);
  console.log("   ", JSON.stringify(closed));
  check("panel hidden after closing", closed.panelHidden === true);
  check("closed state is reported", closed.flag === "closed", closed.flag);
  check("closing message is translated", !/^[a-z]+\.[a-zA-Z.]+$/.test(closed.state), closed.state);
  await page.shot(`${SHOTS}/dash-${language}-closed.png`);

  console.log("\n[dashboard] the language sticks across a reload");
  await page.goto(`${ORIGIN}/`);
  const again = await page.eval(`({
    lang: document.documentElement.lang,
    state: document.getElementById('roomState').textContent
  })`);
  console.log("   ", JSON.stringify(again));
  check("language remembered", again.lang.startsWith(language), again.lang);

  console.log("\n[console]", JSON.stringify(page.consoleErrors().slice(0, 5)));
} finally {
  close();
}

console.log(failures.length ? `\nFAILURES (${failures.length}):\n` + failures.join("\n")
                            : "\nALL CHECKS PASSED");
process.exitCode = failures.length ? 1 : 0;

// A real user journey: open the room, pick a language, join, turn on the mic
// and camera, open settings, and look at what is actually on the screen.
import { open } from "./cdp.mjs";

const ORIGIN = process.env.LINGUA_ORIGIN || "http://127.0.0.1:8788";
const SHOTS = new URL("./shots/", import.meta.url).pathname.replace(/^\//, "");
const locale = process.argv[2] || "es-ES";
const tag = process.argv[3] || locale.toLowerCase();
const port = Number(process.argv[4] || 9333);
const width = Number(process.argv[5] || 390);

const room = await fetch(`${ORIGIN}/api/rooms`, {
  method: "POST", headers: { Origin: ORIGIN, Accept: "application/json" },
}).then(r => r.json());

const { page, close } = await open({ origin: ORIGIN, port });
const failures = [];
function check(label, condition, detail) {
  const state = condition ? "ok  " : "FAIL";
  if (!condition) failures.push(`${label}: ${detail}`);
  console.log(`  ${state} ${label}${detail === undefined ? "" : ` — ${detail}`}`);
}

try {
  await page.viewport(width, 844);
  const seen404 = [];
  page.on(m => {
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400) {
      seen404.push(`${m.params.response.status} ${m.params.response.url}`);
    }
  });

  await page.goto(`${ORIGIN}${room.path}`);

  console.log(`\n[gate] choosing ${locale}`);
  await page.select("#roleLocaleSel", locale);
  const gate = await page.eval(`({
    heading: document.getElementById('roleTitle').textContent,
    label: document.querySelector('.roleLocale span').textContent,
    agree: document.querySelector('.termsAgree').textContent.trim(),
    join: document.getElementById('joinBtn').textContent,
    badge: document.getElementById('roleCapability').textContent,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    checked: document.getElementById('termsAgree').checked,
    disabled: document.getElementById('joinBtn').disabled
  })`);
  console.log(JSON.stringify(gate, null, 2));
  check("gate is translated", gate.heading !== "Choose language" || locale.startsWith("en"), gate.heading);
  check("terms pre-checked", gate.checked === true);
  check("join enabled", gate.disabled === false);
  check("document language set", gate.lang === locale, gate.lang);
  await page.shot(`${SHOTS}/gate-${tag}.png`);

  console.log("\n[join]");
  await page.tap("#joinBtn");
  await page.eval("new Promise(r => setTimeout(r, 1500))");
  const joined = await page.eval(`({
    gateHidden: document.getElementById('roleGate').hidden,
    status: document.getElementById('status').textContent,
    count: document.getElementById('participantCount').textContent,
    note: document.getElementById('videoNote').textContent,
    mic: document.getElementById('micBtn').textContent,
    captions: document.getElementById('captionEmpty').textContent
  })`);
  console.log(JSON.stringify(joined, null, 2));
  check("gate closed", joined.gateHidden === true);
  const micName = await page.eval("document.getElementById('micBtn').getAttribute('aria-label')");
  check("mic button has a translated spoken name", Boolean(micName), micName);
  check("mic button carries no text", joined.mic === "", JSON.stringify(joined.mic));

  console.log("\n[control bar fit]");
  const bar = await page.eval(`(() => {
    const bar = document.getElementById('bar');
    const barBox = bar.getBoundingClientRect();
    const rows = [...bar.children].filter(el => el.id !== 'settings').map(el => {
      const r = el.getBoundingClientRect();
      return {id: el.id, x: Math.round(r.left), right: Math.round(r.right),
              w: Math.round(r.width), h: Math.round(r.height),
              scrollW: el.scrollWidth, clientW: el.clientWidth,
              text: el.textContent.trim(), svg: !!el.querySelector('svg'),
              label: el.getAttribute('aria-label')};
    });
    return {barW: Math.round(barBox.width), viewportW: window.innerWidth,
            docScrollW: document.documentElement.scrollWidth, rows};
  })()`);
  console.log(JSON.stringify(bar, null, 2));
  check("page does not scroll sideways", bar.docScrollW <= bar.viewportW,
        `${bar.docScrollW} <= ${bar.viewportW}`);
  for (const row of bar.rows) {
    check(`${row.id} fits its box`, row.scrollW <= row.clientW + 1,
          `content ${row.scrollW} in ${row.clientW}`);
    check(`${row.id} inside the bar`, row.right <= bar.viewportW + 1, `right edge ${row.right}`);
    check(`${row.id} is tappable`, row.w >= 40 && row.h >= 40, `${row.w}x${row.h}`);
    {
      check(`${row.id} is a glyph`, row.svg && row.text === "", `text=${JSON.stringify(row.text)}`);
      check(`${row.id} has a spoken name`, Boolean(row.label), row.label);
    }
  }
  await page.shot(`${SHOTS}/room-${tag}.png`);

  console.log("\n[microphone]");
  await page.tap("#micBtn");
  await page.eval("new Promise(r => setTimeout(r, 1200))");
  const mic = await page.eval(`({
    label: document.getElementById('micBtn').textContent,
    on: document.getElementById('micBtn').className,
    status: document.getElementById('status').textContent,
    scrollW: document.getElementById('micBtn').scrollWidth,
    clientW: document.getElementById('micBtn').clientWidth
  })`);
  console.log(JSON.stringify(mic, null, 2));
  check("mic turned on", mic.on.includes("on"), mic.on);
  check("mic label still fits", mic.scrollW <= mic.clientW + 1, `${mic.scrollW} in ${mic.clientW}`);

  console.log("\n[camera]");
  await page.tap("#camBtn");
  await page.eval("new Promise(r => setTimeout(r, 1200))");
  const cam = await page.eval(`({
    cls: document.getElementById('camBtn').className,
    selfPlaying: !!document.getElementById('selfVideo').srcObject
  })`);
  console.log(JSON.stringify(cam, null, 2));
  check("camera turned on", cam.cls === "icon", cam.cls);
  check("self preview has a stream", cam.selfPlaying === true);
  await page.shot(`${SHOTS}/room-live-${tag}.png`);

  console.log("\n[settings]");
  const settings = await page.eval(`(() => {
    const rows = [...document.querySelectorAll('#settings .setting')].map(el => ({
      label: el.querySelector('span').textContent,
      options: el.querySelector('select').options.length,
      disabled: el.querySelector('select').disabled,
      scrollW: el.scrollWidth, clientW: el.clientWidth
    }));
    const report = document.getElementById('reportBtn');
    return {rows, report: report.textContent,
            reportFits: report.scrollWidth <= report.clientWidth + 1,
            note: document.getElementById('capabilityNote').textContent};
  })()`);
  console.log(JSON.stringify(settings, null, 2));
  for (const row of settings.rows) {
    check(`setting "${row.label}" fits`, row.scrollW <= row.clientW + 1,
          `${row.scrollW} in ${row.clientW}`);
  }
  check("report button fits", settings.reportFits);
  const picker = await page.eval(`(() => {
    const el = document.getElementById("localeSel");
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:" + getComputedStyle(el).font;
    probe.textContent = el.options[el.selectedIndex].textContent;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return {label: probe.textContent, textW: Math.ceil(w), boxW: el.clientWidth};
  })()`);
  check("in-call language label is not clipped", picker.textW <= picker.boxW - 24,
        `"${picker.label}" ${picker.textW}px in ${picker.boxW}px`);
  check("badge states no voice count", !/\d+\s*\S*voice/i.test(settings.note), settings.note);

  console.log("\n[network + console]");
  console.log("  non-2xx:", JSON.stringify(seen404));
  console.log("  errors:", JSON.stringify(page.consoleErrors()));

  console.log(failures.length ? `\nFAILURES (${failures.length}):\n` + failures.join("\n") : "\nALL CHECKS PASSED");
  process.exitCode = failures.length ? 1 : 0;
} finally {
  close();
}

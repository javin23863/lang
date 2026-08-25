// Two real browsers, one real room, two different languages. Exercises the
// backend for real: room signing, the WebSocket, presence, peer join, and the
// host-control API the dashboard polls.
import { open } from "./cdp.mjs";
import { acceptRoomTerms } from "./room-consent.mjs";
import { sessionToken } from "./session.mjs";

const ORIGIN = process.env.LINGUA_ORIGIN || "http://127.0.0.1:8788";
const SHOTS = new URL("./shots/", import.meta.url).pathname.replace(/^\//, "");

const failures = [];
function check(label, condition, detail) {
  if (!condition) failures.push(`${label}${detail === undefined ? "" : ` — ${detail}`}`);
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}${detail === undefined ? "" : ` — ${detail}`}`);
}

async function joinAs(page, path, locale) {
  await page.viewport(390, 844);
  await page.goto(`${ORIGIN}${path}`);
  await page.select("#roleLocaleSel", locale);
  const consent = await acceptRoomTerms(page);
  check(`${locale} terms start unchecked`, consent.before.checked === false, String(consent.before.checked));
  check(`${locale} join starts locked`, consent.before.disabled === true, String(consent.before.disabled));
  check(`${locale} terms unlock join`, consent.after.checked && !consent.after.disabled,
        JSON.stringify(consent.after));
  await page.tap("#joinBtn");
  await page.eval("new Promise(r => setTimeout(r, 2000))");
}

console.log("[backend] create a room");
// Room creation uses a real signed-in test host session from the target Worker.
// Joining below stays cookie-free on purpose.
const session = await sessionToken();
const created = await fetch(`${ORIGIN}/api/rooms`, {
  method: "POST",
  headers: {Origin: ORIGIN, Accept: "application/json", Cookie: `lr_s=${session}`},
});
check("room created", created.status === 201, `HTTP ${created.status}`);
if (created.status !== 201) throw new Error(`pair journey could not create room (HTTP ${created.status})`);
const room = await created.json();
check("room path is signed", /^\/room\/[\w-]+\.\d+\.[\w-]+$/.test(room.path), room.path.slice(0, 30));

console.log("[backend] a forged token is refused");
const forged = await fetch(`${ORIGIN}/room/notarealtoken.1.aaaa`, { headers: { Origin: ORIGIN } });
check("forged room token rejected", forged.status === 404, `HTTP ${forged.status}`);

console.log("[backend] host control before anyone joins");
const before = await fetch(`${ORIGIN}/api/room-control`, {
  headers: { Authorization: `Bearer ${room.host_control}`, Accept: "application/json",
             Origin: ORIGIN },
}).then(r => r.json());
console.log("   ", JSON.stringify(before));
check("room starts ready with nobody in it", before.state === "ready" && before.participant_count === 0,
      JSON.stringify(before));

const alice = await open({ port: 9401, origin: ORIGIN });
const bob = await open({ port: 9402, origin: ORIGIN });
try {
  console.log("\n[alice] joins in German");
  await joinAs(alice.page, room.path, "de-DE");
  const a1 = await alice.page.eval(`({
    status: document.getElementById('status').textContent,
    count: document.getElementById('participantCount').textContent,
    note: document.getElementById('videoNote').textContent
  })`);
  console.log("   ", JSON.stringify(a1));
  check("alice reached the room", a1.count.startsWith("1"), a1.count);
  check("alice sees German", a1.note.includes("Person") || a1.note.includes("Warten"), a1.note);

  console.log("\n[bob] joins the same room in Arabic");
  await joinAs(bob.page, room.path, "ar-SA");
  await bob.page.eval("new Promise(r => setTimeout(r, 2500))");
  const b1 = await bob.page.eval(`({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    count: document.getElementById('participantCount').textContent,
    status: document.getElementById('status').textContent,
    note: document.getElementById('videoNote').textContent
  })`);
  console.log("   ", JSON.stringify(b1));
  check("bob's page is right-to-left", b1.dir === "rtl", b1.dir);
  check("bob sees two people", b1.count.startsWith("2"), b1.count);

  await alice.page.eval("new Promise(r => setTimeout(r, 1500))");
  const a2 = await alice.page.eval(`({
    count: document.getElementById('participantCount').textContent,
    status: document.getElementById('status').textContent
  })`);
  console.log("   alice now:", JSON.stringify(a2));
  check("alice was told someone joined", a2.count.startsWith("2"), a2.count);
  check("the join notice is in German", /beigetreten|Sprecher|Person/i.test(a2.status), a2.status);

  await alice.page.shot(`${SHOTS}/pair-alice-de.png`);
  await bob.page.shot(`${SHOTS}/pair-bob-ar.png`);

  console.log("\n[backend] host control sees both");
  const during = await fetch(`${ORIGIN}/api/room-control`, {
    headers: { Authorization: `Bearer ${room.host_control}`, Accept: "application/json",
               Origin: ORIGIN },
  }).then(r => r.json());
  console.log("   ", JSON.stringify(during));
  check("server counts two participants", during.participant_count === 2, JSON.stringify(during));
  check("server reports the room open", during.state === "open", during.state);

  console.log("\n[backend] a wrong host token is refused");
  const wrong = await fetch(`${ORIGIN}/api/room-control`, {
    headers: { Authorization: "Bearer hc1.nope.1.aaaa", Origin: ORIGIN },
  });
  check("forged host control rejected", wrong.status === 403 || wrong.status === 401,
        `HTTP ${wrong.status}`);

  console.log("\n[bob] leaves");
  await bob.page.tap("#leaveBtn");
  await bob.page.eval("new Promise(r => setTimeout(r, 2000))");
  const b2 = await bob.page.eval(`({
    status: document.getElementById('status').textContent,
    note: document.getElementById('videoNote').textContent
  })`);
  console.log("   ", JSON.stringify(b2));
  check("bob's exit message is Arabic", /[\u0600-\u06FF]/.test(b2.status), b2.status);

  await alice.page.eval("new Promise(r => setTimeout(r, 2500))");
  const a3 = await alice.page.eval(`({
    count: document.getElementById('participantCount').textContent,
    note: document.getElementById('videoNote').textContent
  })`);
  console.log("   alice now:", JSON.stringify(a3));
  check("alice is alone again", a3.count.startsWith("1"), a3.count);
  // Whichever note is showing, it must be German and never a leftover key.
  check("alice's notice is German", /[a-zA-ZäöüßÄÖÜ]/.test(a3.note) && !/^[a-z]+\.[a-zA-Z.]+$/.test(a3.note)
        && !/\b(the other person|waiting|still trying)\b/i.test(a3.note), a3.note);

  console.log("\n[backend] host closes the room");
  const closed = await fetch(`${ORIGIN}/api/room-control/close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${room.host_control}`, Accept: "application/json",
               Origin: ORIGIN },
  });
  check("close accepted", closed.ok, `HTTP ${closed.status}`);
  await alice.page.eval("new Promise(r => setTimeout(r, 3000))");
  const a4 = await alice.page.eval(`({
    status: document.getElementById('status').textContent,
    note: document.getElementById('videoNote').textContent
  })`);
  console.log("   alice now:", JSON.stringify(a4));
  check("alice was told the room closed, in German",
        /geschlossen/i.test(a4.status) || /geschlossen/i.test(a4.note),
        `${a4.status} / ${a4.note}`);
  await alice.page.shot(`${SHOTS}/pair-alice-closed-de.png`);

  console.log("\n[backend] the link stops working");
  const after = await fetch(`${ORIGIN}${room.path}`, { headers: { Origin: ORIGIN } });
  check("closed room link refused", after.status === 404 || after.status === 410,
        `HTTP ${after.status}`);

  console.log("\n[console]");
  console.log("  alice:", JSON.stringify(alice.page.consoleErrors().slice(0, 4)));
  console.log("  bob:", JSON.stringify(bob.page.consoleErrors().slice(0, 4)));
} finally {
  alice.close();
  bob.close();
}

console.log(failures.length ? `\nFAILURES (${failures.length}):\n` + failures.join("\n")
                            : "\nALL CHECKS PASSED");
process.exitCode = failures.length ? 1 : 0;

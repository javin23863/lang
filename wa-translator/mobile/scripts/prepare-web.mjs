import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.resolve(MOBILE, "..", "windows", "static");
const WWW = path.resolve(MOBILE, "www");
const FOUR_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 4 people<';
const TWO_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 2 people<';
const ROOM_STYLE_PATTERN = /<style>\n([\s\S]*?)\n<\/style>/;
const ROOM_SCRIPT_PATTERN = /<script>\n(const \$ = \(id\) => document\.getElementById\(id\);[\s\S]*?)\n<\/script>\n<\/body>/;
const STATUS_STYLE_SEAM = "el.style.display = text ? 'block' : 'none';";
const STATUS_TIMEOUT_SEAM = "setTimeout(() => { if (el.textContent === text) el.style.display = 'none'; }, 3000);";

if (path.dirname(WWW) !== MOBILE || path.basename(WWW) !== "www") {
  throw new Error(`Refusing unsafe mobile web target: ${WWW}`);
}

function normalizeRoomScript(source) {
  if (!source.includes(STATUS_STYLE_SEAM) || !source.includes(STATUS_TIMEOUT_SEAM)) {
    throw new Error("room status visibility seam is missing");
  }
  return source
    .replace(STATUS_STYLE_SEAM, "el.hidden = !text;")
    .replace(STATUS_TIMEOUT_SEAM,
      "setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 3000);");
}

function enhanceRoomShell(source) {
  return source
    .replace('<div id="videoNote">', '<div id="videoNote" role="status" aria-live="polite">')
    .replace('<div id="status">', '<div id="status" role="status" aria-live="polite">')
    .replace('<div id="captions">',
      '<div id="captions" role="log" aria-live="polite" aria-relevant="additions text">');
}

function decomposeRoom(source) {
  const style = source.match(ROOM_STYLE_PATTERN);
  const script = source.match(ROOM_SCRIPT_PATTERN);
  if (!style || !script) throw new Error("room source decomposition seam is missing");
  return {
    html: enhanceRoomShell(source
      .replace(style[0], '<link rel="stylesheet" href="/room.css">')
      .replace(script[0], '<script src="/room.js"></script>\n</body>')),
    css: `${style[1]}\n`,
    js: `${normalizeRoomScript(script[1])}\n`,
  };
}

await rm(WWW, { recursive: true, force: true });
await cp(SOURCE, WWW, { recursive: true });
await mkdir(path.join(WWW, "static"), { recursive: true });
await cp(path.join(SOURCE, "pcm-worklet.js"), path.join(WWW, "static", "pcm-worklet.js"));
// The runtime asks for interface dictionaries at /static/i18n, the one path
// that resolves the same way under FastAPI, the Worker, and the native shell.
await cp(path.join(SOURCE, "i18n"), path.join(WWW, "static", "i18n"), { recursive: true });

for (const name of ["index.html", "room.html"]) {
  const target = path.join(WWW, name);
  let html = await readFile(target, "utf8");
  const marker = '<script src="/app-runtime.js"></script>';
  if (!html.includes(marker)) throw new Error(`${name} is missing the app runtime seam`);
  html = html.replace(marker, `<script src="/mobile-bridge.js"></script>${marker}`);
  if (name === "room.html") {
    const room = decomposeRoom(html);
    html = room.html;
    await writeFile(path.join(WWW, "room.css"), room.css, "utf8");
    await writeFile(path.join(WWW, "room.js"), room.js, "utf8");
    if (!html.includes(FOUR_PERSON_FALLBACK) && !html.includes(TWO_PERSON_FALLBACK)) {
      throw new Error("room.html is missing the participant-count fallback seam");
    }
    html = html.replace(FOUR_PERSON_FALLBACK, TWO_PERSON_FALLBACK);
  }
  await writeFile(target, html, "utf8");
}

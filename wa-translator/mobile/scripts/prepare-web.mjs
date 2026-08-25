import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.resolve(MOBILE, "..", "windows", "static");
const WWW = path.resolve(MOBILE, "www");
const FOUR_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 4 people<';
const TWO_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 2 people<';

if (path.dirname(WWW) !== MOBILE || path.basename(WWW) !== "www") {
  throw new Error(`Refusing unsafe mobile web target: ${WWW}`);
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
    if (!html.includes(FOUR_PERSON_FALLBACK) && !html.includes(TWO_PERSON_FALLBACK)) {
      throw new Error("room.html is missing the participant-count fallback seam");
    }
    html = html.replace(FOUR_PERSON_FALLBACK, TWO_PERSON_FALLBACK);
  }
  await writeFile(target, html, "utf8");
}

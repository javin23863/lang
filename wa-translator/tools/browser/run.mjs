// One command that drives the shipped app in a real browser and fails loudly.
//
//   1. start the worker:  cd cloudflare && npx wrangler dev -c wrangler.dev.jsonc --port 8788 --local
//   2. sign a dedicated test host into that same Worker origin and export its
//      current s2 browser cookie value as LINGUA_SESSION
//   3. run this:          node tools/browser/run.mjs
//
// Pass language codes to widen the sweep: `node run.mjs de ar fi ja`.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.LINGUA_ORIGIN || "http://127.0.0.1:8788";

// One language per script of a different shape: Latin, Arabic right-to-left,
// an agglutinative language that builds very long words, and one that does not
// separate words at all.
const LANGUAGES = process.argv.slice(2).length ? process.argv.slice(2)
  : ["de", "ar", "fi", "ja"];
const LOCALES = { de: "de-DE", ar: "ar-SA", fi: "fi-FI", ja: "ja-JP", es: "es-ES",
                  he: "he-IL", ru: "ru-RU", zh: "zh-CN", hi: "hi-IN", tr: "tr-TR" };

function run(script, args, port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, script), ...args],
                        { stdio: "inherit", env: { ...process.env, LINGUA_ORIGIN: ORIGIN } });
    child.on("exit", (code) => resolve({ script, args, code: code ?? 1, port }));
  });
}

const health = await fetch(ORIGIN).then(r => r.status).catch(() => 0);
if (health !== 200) {
  console.error(`No app at ${ORIGIN} (got ${health}). Start the worker first — see the top of this file.`);
  process.exit(2);
}
if (!process.env.LINGUA_SESSION) {
  console.error("LINGUA_SESSION is required. Use a dedicated test host signed into the target Worker; "
                + "a signing key alone cannot satisfy the live-account guard.");
  process.exit(2);
}

const results = [];
let port = 9800;
for (const language of LANGUAGES) {
  const locale = LOCALES[language] ?? `${language}-${language.toUpperCase()}`;
  console.log(`\n${"=".repeat(70)}\n== room journey: ${locale}\n${"=".repeat(70)}`);
  results.push(await run("journey.mjs", [locale, language, String(port++)]));
  console.log(`\n${"=".repeat(70)}\n== room journey at 320px: ${locale}\n${"=".repeat(70)}`);
  results.push(await run("journey.mjs", [locale, `${language}-narrow`, String(port++), "320"]));
  console.log(`\n${"=".repeat(70)}\n== host dashboard: ${language}\n${"=".repeat(70)}`);
  results.push(await run("dashboard.mjs", [language, String(port++)]));
}
console.log(`\n${"=".repeat(70)}\n== two participants, two languages, one room\n${"=".repeat(70)}`);
results.push(await run("pair.mjs", []));

const failed = results.filter(r => r.code !== 0);
console.log(`\n${"=".repeat(70)}`);
for (const r of results) {
  console.log(`  ${r.code === 0 ? "pass" : "FAIL"}  ${r.script} ${r.args.join(" ")}`);
}
console.log(`${failed.length ? `${failed.length} of ${results.length} runs failed`
                              : `all ${results.length} runs passed`}`);
console.log(`screenshots: ${path.join(HERE, "shots")}`);
process.exit(failed.length ? 1 : 0);

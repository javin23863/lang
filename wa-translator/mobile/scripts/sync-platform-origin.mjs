import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MOBILE_AUTH_SCHEME, PUBLIC_ORIGIN } from "../src/runtime-core.mjs";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = new URL(PUBLIC_ORIGIN);
if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error(`PUBLIC_ORIGIN must be a bare https origin: ${PUBLIC_ORIGIN}`);
}
const host = origin.hostname;
if (!host || host === "localhost" || host.endsWith(".localhost")) {
  throw new Error(`PUBLIC_ORIGIN cannot be a local development host: ${PUBLIC_ORIGIN}`);
}
if (!/^[A-Za-z][A-Za-z0-9.+-]*$/.test(MOBILE_AUTH_SCHEME)) {
  throw new Error(`Invalid mobile auth URL scheme: ${MOBILE_AUTH_SCHEME}`);
}

async function replaceExactlyOnce(file, pattern, replacement, description) {
  const original = await readFile(file, "utf8");
  const matches = original.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g")) || [];
  if (matches.length !== 1) {
    throw new Error(`${description}: expected exactly one synchronization seam, found ${matches.length}`);
  }
  const next = original.replace(pattern, replacement);
  if (next !== original) await writeFile(file, next, "utf8");
}

await replaceExactlyOnce(
  path.join(MOBILE, "android", "app", "src", "main", "AndroidManifest.xml"),
  /(<data\s+android:scheme="https"\s+android:host=")[^"]+("\s+android:pathPrefix="\/room\/"\s*\/\>)/,
  `$1${host}$2`,
  "Android verified-link host",
);

await replaceExactlyOnce(
  path.join(MOBILE, "ios", "App", "App", "App.entitlements"),
  /<string>applinks:[^<]+<\/string>/,
  `<string>applinks:${host}</string>`,
  "iOS associated-domain host",
);

await replaceExactlyOnce(
  path.join(MOBILE, "ios", "App", "App", "Info.plist"),
  /<string>com\.javin23863\.linguarelay<\/string>(?=\s*<\/array>\s*<\/dict>\s*<\/array>)/,
  `<string>${MOBILE_AUTH_SCHEME}</string>`,
  "iOS auth-return URL scheme",
);

console.log(`Native associations synchronized to ${host}; auth scheme ${MOBILE_AUTH_SCHEME}.`);

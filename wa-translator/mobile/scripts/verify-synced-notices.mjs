import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_MARKERS = [
  "Lingua Relay third-party notices",
  "@capacitor/core@8.5.0",
  "@aparajita/capacitor-secure-storage@8.0.0",
];
const TARGETS = [
  path.join(MOBILE, "android", "app", "src", "main", "assets", "public", "third-party-notices.txt"),
  path.join(MOBILE, "ios", "App", "App", "public", "third-party-notices.txt"),
];

for (const target of TARGETS) {
  let text;
  try {
    text = await readFile(target, "utf8");
  } catch (error) {
    throw new Error(`Synced native app is missing third-party notices: ${target}`, {cause: error});
  }
  for (const marker of EXPECTED_MARKERS) {
    if (!text.includes(marker)) {
      throw new Error(`Synced third-party notice ${target} is missing ${marker}`);
    }
  }
}

console.log("Synced Android/iOS third-party notices verified.");

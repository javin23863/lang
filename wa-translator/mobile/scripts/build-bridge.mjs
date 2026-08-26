import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PUBLIC_ORIGIN,
  STAGING_PUBLIC_ORIGIN,
  resolvePublicOrigin,
} from "../src/runtime-core.mjs";

export const PRODUCTION_ORIGIN = PUBLIC_ORIGIN;
export const STAGING_ORIGIN = STAGING_PUBLIC_ORIGIN;
export { resolvePublicOrigin };

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const origin = resolvePublicOrigin(process.env.LINGUA_PUBLIC_ORIGIN);
  const www = path.join(mobile, "www");
  await build({
    entryPoints: [path.join(mobile, "src", "mobile-entry.ts")],
    outfile: path.join(www, "mobile-bridge.js"),
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    banner: {
      js: `globalThis.__LINGUA_PUBLIC_ORIGIN__=${JSON.stringify(origin)};`,
    },
  });
  await writeFile(
    path.join(www, "native-build-target.json"),
    `${JSON.stringify({ public_origin: origin })}\n`,
    "utf8",
  );
  console.log(`native bridge target: ${origin}`);
}

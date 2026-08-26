import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_ORIGIN =
  "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev";
export const STAGING_ORIGIN =
  "https://spoken-translation-room-staging.spoken-translation-cloudflare.workers.dev";
const ALLOWED_ORIGINS = new Set([PRODUCTION_ORIGIN, STAGING_ORIGIN]);

export function resolvePublicOrigin(value = "") {
  const origin = String(value || PRODUCTION_ORIGIN).trim();
  if (!ALLOWED_ORIGINS.has(origin)) {
    throw new Error(`Unsupported LINGUA_PUBLIC_ORIGIN: ${origin}`);
  }
  return origin;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;

if (invokedDirectly) {
  const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const origin = resolvePublicOrigin(process.env.LINGUA_PUBLIC_ORIGIN);
  await build({
    entryPoints: [path.join(mobile, "src", "mobile-entry.ts")],
    outfile: path.join(mobile, "www", "mobile-bridge.js"),
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    define: {
      __LINGUA_PUBLIC_ORIGIN__: JSON.stringify(origin),
    },
  });
  console.log(`native bridge target: ${origin}`);
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const configPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const source = readFileSync(configPath, "utf8");

const required = [
  [
    /"upload_source_maps"\s*:\s*true/,
    "production Wrangler config must upload source maps so uncaught Worker errors resolve to TypeScript source",
  ],
  [
    /"logs"\s*:\s*\{[\s\S]*?"enabled"\s*:\s*true/,
    "production Workers Logs must be enabled",
  ],
  [
    /"invocation_logs"\s*:\s*false/,
    "automatic invocation logs must stay disabled because room URLs are capability-bearing",
  ],
];

for (const [pattern, message] of required) {
  if (!pattern.test(source)) {
    console.error(`Observability config check: ${message}.`);
    process.exit(1);
  }
}

if (/"invocation_logs"\s*:\s*true/.test(source)) {
  console.error(
    "Observability config check: invocation logs cannot be enabled until request-path redaction is proven safe.",
  );
  process.exit(1);
}

console.log(
  "Observability config check: source maps enabled; Workers Logs enabled without capability-bearing invocation URLs.",
);

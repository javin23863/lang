import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const SECRET_KEY = /(?:SECRET|SIGNING_KEY|ADMIN_TOKEN|CLIENT_SECRET|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIAL|CERT(?:IFICATE)?|KEYSTORE)$/i;
const EXPECTED_BINDINGS = ["ABUSE", "REPORTS", "ROOMS", "USERS"];

async function readJsonc(name) {
  const source = await readFile(new URL(name, ROOT), "utf8");
  const withoutWholeLineComments = source
    .split("\n")
    .filter(line => !line.trimStart().startsWith("//"))
    .join("\n");
  return JSON.parse(withoutWholeLineComments);
}

function assertShippingShape(config, label, entrypoint = "src/session-issuance-entry.ts") {
  assert.equal(config.main, entrypoint, `${label} uses the guarded shipping entrypoint`);
  assert.equal(config.upload_source_maps, true, `${label} uploads source maps`);
  assert.equal(config.observability?.logs?.enabled, true, `${label} enables Workers Logs`);
  assert.equal(config.observability?.logs?.invocation_logs, false,
    `${label} never enables automatic capability-bearing invocation URLs`);
  assert.equal(config.assets?.directory, "../windows/static", `${label} serves the shipping web client`);
  assert.equal(config.assets?.run_worker_first, true, `${label} keeps security routing in front of assets`);

  const bindings = (config.durable_objects?.bindings || []).map(binding => binding.name).sort();
  assert.deepEqual(bindings, EXPECTED_BINDINGS, `${label} has the complete isolated Durable Object surface`);

  for (const key of Object.keys(config.vars || {})) {
    assert.doesNotMatch(key, SECRET_KEY, `${label} must not commit credential-like ${key} under vars`);
  }
}

function publicOrigin(config, label) {
  const value = config.vars?.PUBLIC_ORIGIN;
  assert.equal(typeof value, "string", `${label} declares PUBLIC_ORIGIN`);
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `${label} PUBLIC_ORIGIN is HTTPS`);
  assert.ok(!["localhost", "127.0.0.1", "::1"].includes(url.hostname),
    `${label} PUBLIC_ORIGIN is not loopback`);
  assert.equal(url.pathname, "/", `${label} PUBLIC_ORIGIN has no path prefix`);
  assert.equal(url.search, "", `${label} PUBLIC_ORIGIN has no query`);
  assert.equal(url.hash, "", `${label} PUBLIC_ORIGIN has no fragment`);
  return url.origin;
}

const production = await readJsonc("wrangler.jsonc");
const staging = await readJsonc("wrangler.staging.jsonc");
const development = await readJsonc("wrangler.dev.jsonc");

assertShippingShape(production, "production");
assertShippingShape(staging, "staging", "src/staging-release-entry.ts");
assert.equal(staging.vars?.RELEASE_SHA, "__RELEASE_SHA__",
  "staging release SHA is injected only by the exact-source deployment workflow");

assert.equal(production.name, "spoken-translation-room", "production worker name is pinned");
assert.equal(staging.name, "spoken-translation-room-staging", "staging worker name is pinned");
assert.notEqual(staging.name, production.name, "staging cannot deploy over production");

const productionOrigin = publicOrigin(production, "production");
const stagingOrigin = publicOrigin(staging, "staging");
assert.notEqual(stagingOrigin, productionOrigin, "staging and production origins are isolated");
assert.match(stagingOrigin, /staging/i, "staging origin is visibly non-production");

assert.equal(development.name, "spoken-translation-room-dev", "development worker name is pinned");
assert.equal(development.main, "src/session-issuance-entry.ts", "development crosses the shipping guard chain");
assert.notEqual(development.name, production.name, "development cannot deploy over production");
assert.notEqual(development.name, staging.name, "development cannot deploy over staging");
assert.equal(development.vars?.PUBLIC_ORIGIN, "http://127.0.0.1:8788", "development stays loopback-only");

for (const key of ["ROOM_SIGNING_KEY", "MODAL_SHARED_SECRET", "MOBILE_REPORT_ADMIN_TOKEN"]) {
  const value = development.vars?.[key];
  assert.equal(typeof value, "string", `development supplies ${key}`);
  assert.match(value, /^local-dev-only-/, `${key} is unmistakably local-only`);
}

for (const config of [production, staging]) {
  for (const value of Object.values(config.vars || {})) {
    assert.ok(!String(value).includes("local-dev-only-"), "shipping configs contain no local credential placeholders");
  }
}

// Keep the credential-key denylist itself under regression. These representative
// names are all unsafe in committed shipping vars even when a future config has
// not started using them yet.
for (const key of [
  "ACCESS_TOKEN", "DATABASE_PASSWORD", "APPLE_PRIVATE_KEY", "DEPLOY_CREDENTIAL",
  "CLIENT_CERTIFICATE", "ANDROID_KEYSTORE",
]) {
  assert.match(key, SECRET_KEY, `credential guard recognizes ${key}`);
}

console.log("Environment config check: development, staging, and production are isolated and shipping configs contain no committed credential values.");

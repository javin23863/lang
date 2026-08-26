import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 12_000;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const REQUIRED_LEGAL = Object.freeze([
  "/privacy",
  "/terms",
  "/support",
  "/delete-account.html",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(fetchImpl, origin, pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(new URL(pathname, origin), {
      headers: {Accept: "application/json, text/html;q=0.9, */*;q=0.8"},
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function smokeDeployment(originInput, fetchImpl = fetch, expectedReleaseSha = "") {
  const origin = new URL(originInput);
  assert(origin.protocol === "https:", "smoke origin must use https");
  assert(origin.pathname === "/", "smoke origin must not contain a path");
  assert(!origin.username && !origin.password && !origin.search && !origin.hash,
    "smoke origin must not contain credentials, query, or fragment");
  if (expectedReleaseSha) {
    assert(RELEASE_SHA_PATTERN.test(expectedReleaseSha),
      "expected release SHA must be an exact lowercase 40-character commit SHA");
  }

  const health = await request(fetchImpl, origin, "/health");
  assert(health.status === 200, `health returned ${health.status}`);
  const healthBody = await health.json();
  assert(healthBody?.status === "ok", "health payload is not ok");

  const bootstrap = await request(fetchImpl, origin, "/api/v1/mobile/bootstrap");
  assert(bootstrap.status === 200, `bootstrap returned ${bootstrap.status}`);
  const contract = await bootstrap.json();
  assert(contract?.protocol === 2, "bootstrap protocol is not 2");
  assert(contract?.public_origin === origin.origin, "bootstrap public_origin does not match deployment");
  assert(contract?.account_mode === "session", "bootstrap account_mode is not session");
  assert(contract?.call_lifecycle === "foreground", "bootstrap call_lifecycle is not foreground");
  assert(contract?.max_room_participants === 2, "bootstrap participant limit is not 2");
  if (expectedReleaseSha) {
    assert(contract?.release_sha === expectedReleaseSha,
      `live release SHA ${String(contract?.release_sha || "missing")} does not match ${expectedReleaseSha}`);
  }

  const dashboard = await request(fetchImpl, origin, "/");
  assert(dashboard.status === 200, `dashboard returned ${dashboard.status}`);
  const csp = dashboard.headers.get("Content-Security-Policy") || "";
  assert(csp.includes("default-src 'none'"), "dashboard CSP is missing deny-by-default policy");
  assert(dashboard.headers.get("Permissions-Policy") === "camera=(), microphone=()",
    "dashboard permissions policy drifted");
  const dashboardText = await dashboard.text();
  assert(dashboardText.includes("Lingua Relay"), "dashboard does not identify Lingua Relay");

  for (const pathname of REQUIRED_LEGAL) {
    const response = await request(fetchImpl, origin, pathname);
    assert(response.status === 200, `${pathname} returned ${response.status}`);
    const text = await response.text();
    assert(text.includes("Lingua Relay"), `${pathname} does not identify Lingua Relay`);
    assert(!/\b(?:TODO|localhost|development only)\b/i.test(text),
      `${pathname} contains a launch placeholder`);
    if (pathname === "/delete-account.html") {
      assert(/Delete your Lingua Relay account/i.test(text), "deletion page copy drifted");
      assert(/do not need the mobile app/i.test(text), "deletion page no-app path is missing");
    }
  }

  return Object.freeze({origin: origin.origin, status: "ok", release_sha: expectedReleaseSha || null});
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const origin = process.argv[2] || process.env.LINGUA_SMOKE_ORIGIN;
  const expectedReleaseSha = process.env.LINGUA_EXPECTED_RELEASE_SHA || "";
  if (!origin) throw new Error("usage: node scripts/smoke-deployment.mjs https://deployment.example");
  const result = await smokeDeployment(origin, fetch, expectedReleaseSha);
  console.log(`deployment smoke passed: ${result.origin}`
    + (result.release_sha ? ` @ ${result.release_sha}` : ""));
}

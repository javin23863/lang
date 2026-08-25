import { pathToFileURL } from "node:url";

export const PUBLIC_ORIGIN =
  "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev";
export const APP_ID = "com.javin23863.linguarelay";
export const PARTICIPANT_LIMIT = 2;
export const MOBILE_PROTOCOL = 1;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeFingerprint(value) {
  const hex = String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g).join(":");
}

export function validateBootstrap(value) {
  requireCondition(value && typeof value === "object", "mobile bootstrap is not an object");
  requireCondition(value.protocol === MOBILE_PROTOCOL, "mobile protocol mismatch");
  requireCondition(value.public_origin === PUBLIC_ORIGIN, "mobile public origin mismatch");
  requireCondition(value.account_mode === "session", "mobile account mode mismatch");
  requireCondition(value.call_lifecycle === "foreground", "mobile call lifecycle mismatch");
  requireCondition(value.max_room_participants === PARTICIPANT_LIMIT,
    "live backend is not enforcing the two-person room contract");
  requireCondition(Number.isSafeInteger(value.minimum_client_build),
    "mobile minimum client build is missing");
  return true;
}

export function validateProviderSnapshot(value, platform) {
  requireCondition(value && typeof value === "object", "account snapshot is not an object");
  const providers = Array.isArray(value.providers)
    ? value.providers.filter(provider => typeof provider === "string") : [];
  requireCondition(providers.length > 0, "live backend offers no sign-in provider");
  if (platform === "ios") {
    requireCondition(providers.includes("apple"),
      "live backend does not offer Apple login required by the iOS release gate");
  }
  return true;
}

export function validateAppleAssociation(value, teamId) {
  requireCondition(/^[A-Z0-9]{10}$/.test(teamId || ""), "APPLE_TEAM_ID is invalid");
  const details = value?.applinks?.details;
  requireCondition(Array.isArray(details), "Apple association details are missing");
  const expectedAppId = `${teamId}.${APP_ID}`;
  const entry = details.find(item => item && item.appID === expectedAppId);
  requireCondition(entry, `Apple association does not contain ${expectedAppId}`);
  requireCondition(Array.isArray(entry.components)
    && entry.components.some(component => component?.["/"] === "/room/*"),
  "Apple association does not claim room invitation links");
  return true;
}

export function validateAndroidAssociation(value, fingerprint) {
  const expected = normalizeFingerprint(fingerprint);
  requireCondition(expected, "Android signing SHA-256 fingerprint is invalid");
  requireCondition(Array.isArray(value), "Android assetlinks document is not an array");
  const entry = value.find(item => item?.target?.namespace === "android_app"
    && item.target.package_name === APP_ID
    && Array.isArray(item.relation)
    && item.relation.includes("delegate_permission/common.handle_all_urls"));
  requireCondition(entry, `Android assetlinks does not contain ${APP_ID}`);
  const fingerprints = Array.isArray(entry.target.sha256_cert_fingerprints)
    ? entry.target.sha256_cert_fingerprints.map(normalizeFingerprint).filter(Boolean) : [];
  requireCondition(fingerprints.includes(expected),
    "Android assetlinks does not contain the release signing certificate");
  return true;
}

async function liveJson(path, nativeOrigin) {
  const response = await fetch(`${PUBLIC_ORIGIN}${path}`, {
    cache: "no-store",
    headers: nativeOrigin ? {Accept: "application/json", Origin: nativeOrigin}
      : {Accept: "application/json"},
    redirect: "error",
  });
  requireCondition(response.ok, `${path} returned HTTP ${response.status}`);
  return response.json();
}

async function legalSurface(path) {
  const response = await fetch(`${PUBLIC_ORIGIN}${path}`, {cache: "no-store", redirect: "error"});
  requireCondition(response.ok, `${path} returned HTTP ${response.status}`);
  const text = await response.text();
  requireCondition(text.includes("Lingua Relay") && !/TODO|development placeholder/i.test(text),
    `${path} is not a production legal/support surface`);
}

export async function runPreflight(platform, environment = process.env) {
  requireCondition(platform === "android" || platform === "ios",
    "usage: node scripts/store-preflight.mjs <android|ios>");
  const nativeOrigin = platform === "android" ? "https://localhost" : "capacitor://localhost";
  validateBootstrap(await liveJson("/api/v1/mobile/bootstrap", nativeOrigin));
  validateProviderSnapshot(await liveJson("/api/v1/me", nativeOrigin), platform);
  await Promise.all([legalSurface("/privacy"), legalSurface("/terms"), legalSurface("/support")]);

  if (platform === "ios") {
    validateAppleAssociation(
      await liveJson("/.well-known/apple-app-site-association"),
      environment.APPLE_TEAM_ID || "",
    );
  } else {
    validateAndroidAssociation(
      await liveJson("/.well-known/assetlinks.json"),
      environment.MOBILE_ANDROID_CERT_SHA256 || "",
    );
  }
  return true;
}

async function main() {
  await runPreflight(process.argv[2]);
  console.log(`Store preflight passed for ${process.argv[2]}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Store preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

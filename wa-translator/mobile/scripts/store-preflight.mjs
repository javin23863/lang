import { pathToFileURL } from "node:url";
import { PUBLIC_ORIGIN } from "../src/runtime-core.mjs";

export { PUBLIC_ORIGIN };
export const APP_ID = "com.javin23863.linguarelay";
export const PARTICIPANT_LIMIT = 2;
export const MOBILE_PROTOCOL = 1;
export const PLAY_VERSION_CODE_MAX = 2_100_000_000;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeFingerprint(value) {
  const hex = String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g).join(":");
}

export function releaseBuildNumber(platform, environment = process.env) {
  const raw = platform === "android"
    ? environment.LINGUA_ANDROID_VERSION_CODE
    : platform === "ios" ? environment.LINGUA_IOS_BUILD_NUMBER : undefined;
  const build = Number(raw);
  requireCondition(Number.isSafeInteger(build) && build >= 1,
    `${platform} release build number is missing or invalid`);
  if (platform === "android") {
    requireCondition(build <= PLAY_VERSION_CODE_MAX,
      `Android versionCode ${build} exceeds Google Play maximum ${PLAY_VERSION_CODE_MAX}`);
  }
  return build;
}

export function validateBootstrap(value, buildNumber) {
  requireCondition(value && typeof value === "object", "mobile bootstrap is not an object");
  requireCondition(Number.isSafeInteger(buildNumber) && buildNumber >= 1,
    "release build number is missing or invalid");
  requireCondition(value.protocol === MOBILE_PROTOCOL, "mobile protocol mismatch");
  requireCondition(value.public_origin === PUBLIC_ORIGIN, "mobile public origin mismatch");
  requireCondition(value.account_mode === "session", "mobile account mode mismatch");
  requireCondition(value.call_lifecycle === "foreground", "mobile call lifecycle mismatch");
  requireCondition(value.max_room_participants === PARTICIPANT_LIMIT,
    "live backend is not enforcing the two-person room contract");
  requireCondition(Number.isSafeInteger(value.minimum_client_build),
    "mobile minimum client build is missing");
  requireCondition(value.minimum_client_build <= buildNumber,
    `live backend requires mobile build ${value.minimum_client_build}, but upload build is ${buildNumber}`);
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
  return text;
}

async function deletionSurface() {
  const path = "/delete-account.html";
  const text = await legalSurface(path);
  requireCondition(/Delete your Lingua Relay account/i.test(text),
    `${path} does not identify the account deletion pathway`);
  requireCondition(/do not need the mobile app/i.test(text),
    `${path} does not confirm deletion is available outside the installed app`);
  requireCondition(/Open Lingua Relay account controls/i.test(text),
    `${path} does not link to browser account controls`);
}

export async function runPreflight(platform, environment = process.env) {
  requireCondition(platform === "android" || platform === "ios",
    "usage: node scripts/store-preflight.mjs <android|ios>");
  const buildNumber = releaseBuildNumber(platform, environment);
  const nativeOrigin = platform === "android" ? "https://localhost" : "capacitor://localhost";
  validateBootstrap(await liveJson("/api/v1/mobile/bootstrap", nativeOrigin), buildNumber);
  validateProviderSnapshot(await liveJson("/api/v1/me", nativeOrigin), platform);
  await Promise.all([
    legalSurface("/privacy"), legalSurface("/terms"), legalSurface("/support"), deletionSurface(),
  ]);

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

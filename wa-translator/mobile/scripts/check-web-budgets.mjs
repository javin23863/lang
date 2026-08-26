import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WWW = path.join(MOBILE, "www");

const KiB = 1024;
const BUDGETS = Object.freeze({
  dashboardJs: 160 * KiB,
  dashboardCss: 16 * KiB,
  mobileBridge: 64 * KiB,
  roomJs: 96 * KiB,
  roomCss: 32 * KiB,
  dashboardHtml: 24 * KiB,
});

const DASHBOARD_JS = Object.freeze([
  "mobile-bridge.js",
  "app-runtime.js",
  "dashboard-api.js",
  "dashboard-account.js",
  "dashboard-room-model.js",
  "dashboard-room-controller.js",
  "dashboard-share.js",
  "dashboard-settings.js",
  "dashboard-lifecycle.js",
  "product-events.js",
  "dashboard-onboarding.js",
  "dashboard-product-events.js",
  "qr.js",
  "dashboard.js",
]);
const DASHBOARD_CSS = Object.freeze(["design-tokens.css", "dashboard.css"]);
const ROOM_CSS = Object.freeze(["room.css", "room-ui.css"]);

async function bytes(name) {
  const value = await stat(path.join(WWW, name));
  if (!value.isFile()) throw new Error(`Expected web asset file: ${name}`);
  return value.size;
}

async function total(names) {
  let sum = 0;
  for (const name of names) sum += await bytes(name);
  return sum;
}

function format(value) {
  return `${(value / KiB).toFixed(1)} KiB`;
}

function assertBudget(label, actual, limit) {
  console.log(`${label}: ${format(actual)} / ${format(limit)}`);
  if (actual > limit) {
    throw new Error(`${label} exceeds budget by ${format(actual - limit)}`);
  }
}

const measurements = {
  dashboardJs: await total(DASHBOARD_JS),
  dashboardCss: await total(DASHBOARD_CSS),
  mobileBridge: await bytes("mobile-bridge.js"),
  roomJs: await bytes("room.js"),
  roomCss: await total(ROOM_CSS),
  dashboardHtml: await bytes("index.html"),
};

for (const [label, actual] of Object.entries(measurements)) {
  assertBudget(label, actual, BUDGETS[label]);
}

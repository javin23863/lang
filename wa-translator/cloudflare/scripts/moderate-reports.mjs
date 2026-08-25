#!/usr/bin/env node

const [command, reportId, ...extra] = process.argv.slice(2);
const origin = String(process.env.LINGUA_PUBLIC_ORIGIN || "").replace(/\/$/, "");
const token = String(process.env.MOBILE_REPORT_ADMIN_TOKEN || "");
const REPORT_ID = /^[A-Za-z0-9_-]{22}$/;

function fail(message) {
  console.error(`moderation: ${message}`);
  process.exitCode = 1;
}

function validOrigin(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash
      && (url.protocol === "https:"
        || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)));
  } catch {
    return false;
  }
}

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 160);
    throw new Error(`${response.status}${detail ? ` ${detail}` : ""}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

if (!validOrigin(origin)) {
  fail("set LINGUA_PUBLIC_ORIGIN to the deployed HTTPS origin (localhost HTTP is allowed for development)");
} else if (token.length < 32) {
  fail("set MOBILE_REPORT_ADMIN_TOKEN in the environment; never pass it on the command line");
} else if (extra.length || !["list", "close"].includes(command || "")) {
  fail("usage: npm run reports:list | npm run reports:close -- <22-character-report-id>");
} else if (command === "close" && !REPORT_ID.test(reportId || "")) {
  fail("close requires the exact 22-character report id from the private queue");
} else if (command === "list" && reportId) {
  fail("list takes no report id");
} else {
  try {
    if (command === "list") {
      const body = await request("/api/internal/reports");
      const reports = Array.isArray(body?.reports) ? body.reports : [];
      if (!reports.length) {
        console.log("No retained reports.");
      } else {
        for (const report of reports) {
          const row = {
            id: report?.id,
            created_at: report?.created_at,
            category: report?.category,
            platform: report?.platform,
            room_ref: report?.room_ref,
          };
          console.log(JSON.stringify(row));
        }
      }
    } else {
      const body = await request(`/api/internal/reports/${reportId}/close`, {method: "POST"});
      console.log(JSON.stringify({report_id: reportId, state: body?.state || "closed"}));
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : "request failed");
  }
}

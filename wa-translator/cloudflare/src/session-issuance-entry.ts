import accountGuardEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./account-guard-entry";
import {
  logOperationalException,
  logOperationalFailure,
  logOperationalSuccess,
  operationalExceptionRecord,
  operationalFailureRecord,
  operationalSuccessRecord,
  withFailureRequestId,
} from "./operational-telemetry";
import { inspectSessionToken, mintSessionV2, type SessionIdentity } from "./session-v2";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const NATIVE_HANDOFF_PATH = "/api/v1/auth/handoff";
const MOBILE_BOOTSTRAP_PATH = "/api/v1/mobile/bootstrap";
const NATIVE_REPORT_PATH = "/api/v1/reports";
const BROWSER_OAUTH_START_PATTERN = /^\/auth\/(google|apple|facebook)\/start$/;
const BROWSER_OAUTH_CALLBACK_PATTERN = /^\/auth\/(google|apple|facebook)\/callback$/;
const SESSION_COOKIE = "lr_s";
const NATIVE_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const ROOM_TOKEN_PATTERN = /^([A-Za-z0-9_-]{24})\.(\d{10})\.[A-Za-z0-9_-]{43}$/;
const MOBILE_PROTOCOL = 2;
const ROOM_RUNTIME_MARKER = '<script src="/app-runtime.js"></script>';
const ROOM_CLIENT_SCRIPTS = `${ROOM_RUNTIME_MARKER}\n<script src="/product-events.js"></script>\n<script src="/room-product-events.js"></script>\n<script src="/room-blocking.js"></script>`;

function setCookieValues(headers: Headers): string[] {
  return typeof headers.getSetCookie === "function"
    ? headers.getSetCookie() : [headers.get("Set-Cookie") || ""].filter(Boolean);
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function registerSessionIssuance(identity: SessionIdentity, env: Env): Promise<boolean> {
  const response = await env.USERS.get(env.USERS.idFromName(identity.userId)).fetch(
    new Request("https://users.internal/session-issuances", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({digest: identity.digest, expires_at: identity.expiresAt}),
    })
  );
  const status = response.status;
  await response.body?.cancel().catch(() => {});
  return status === 204;
}

async function browserOAuthAccountSwitchGuard(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || !BROWSER_OAUTH_START_PATTERN.test(url.pathname)) return null;

  const probeUrl = new URL(request.url);
  probeUrl.pathname = "/api/me";
  probeUrl.search = "";
  const headers = new Headers(request.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Type");
  const probe = await accountGuardEntry.fetch(new Request(probeUrl, {
    method: "GET", headers, redirect: "manual"
  }), env, ctx);
  if (!probe.ok) return probe;

  try {
    const body = await probe.clone().json() as {signed_in?: unknown};
    await probe.body?.cancel().catch(() => {});
    if (body.signed_in !== true) return null;
  } catch {
    await probe.body?.cancel().catch(() => {});
    return new Response("Session service unavailable", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // The dashboard retires device-local room administration as part of explicit
  // logout. Starting a second OAuth identity while the first session is live
  // would bypass that custody boundary and let the new account inherit it.
  return new Response("Sign out before switching accounts", {
    status: 409,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function registeredBrowserOAuthCallback(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!BROWSER_OAUTH_CALLBACK_PATTERN.test(url.pathname)) return null;
  const response = await accountGuardEntry.fetch(request, env, ctx);
  const cookies = setCookieValues(response.headers);
  const sessionCookie = cookies.find(value => /^lr_s=s2\./.test(value));
  if (!sessionCookie) return response;

  const token = sessionCookie.slice(`${SESSION_COOKIE}=`.length).split(";")[0];
  try {
    const identity = await inspectSessionToken(token, env.ROOM_SIGNING_KEY);
    if (!identity || identity.version !== 2 || !await registerSessionIssuance(identity, env)) {
      throw new Error("session issuance registration failed");
    }
    return response;
  } catch {
    // The provider identity may already be stored, but no external bearer may
    // escape unless its post-deletion generation is durably registered.
    await response.body?.cancel().catch(() => {});
    const headers = new Headers(response.headers);
    headers.delete("Location");
    headers.delete("Content-Length");
    headers.delete("Set-Cookie");
    for (const cookie of cookies) {
      if (!cookie.startsWith(`${SESSION_COOKIE}=`)) headers.append("Set-Cookie", cookie);
    }
    headers.append("Set-Cookie", clearSessionCookie());
    headers.set("Cache-Control", "no-store");
    return new Response("Authentication unavailable", {status: 503, headers});
  }
}

async function v2MobileBootstrap(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== MOBILE_BOOTSTRAP_PATH || request.method !== "GET") return null;
  const response = await accountGuardEntry.fetch(request, env, ctx);
  if (!response.ok) return response;
  try {
    const body = await response.json<Record<string, unknown>>();
    body.protocol = MOBILE_PROTOCOL;
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    return Response.json(body, {status: response.status, headers});
  } catch {
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.set("Cache-Control", "no-store");
    return new Response("Mobile compatibility unavailable", {status: 503, headers});
  }
}

function withoutSetCookie(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("Set-Cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function upgradedNativeHandoff(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== NATIVE_HANDOFF_PATH || request.method === "OPTIONS") return null;

  const response = await accountGuardEntry.fetch(request, env, ctx);
  if (!response.ok || request.method !== "POST") return withoutSetCookie(response);

  try {
    const body = await response.json() as {session?: unknown; expires_at?: unknown};
    if (typeof body.session !== "string") throw new Error("native session missing");
    const legacy = await inspectSessionToken(body.session, env.ROOM_SIGNING_KEY);
    if (!legacy || legacy.version !== 1) throw new Error("native legacy session invalid");
    if (body.expires_at !== legacy.expiresAt) throw new Error("native session expiry mismatch");
    const upgraded = await mintSessionV2(legacy.userId, env.ROOM_SIGNING_KEY, legacy.expiresAt);
    const identity = await inspectSessionToken(upgraded.token, env.ROOM_SIGNING_KEY);
    if (!identity || identity.version !== 2 || !await registerSessionIssuance(identity, env)) {
      throw new Error("native session issuance registration failed");
    }
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    // A native handoff is bearer-only. Even if a lower layer regresses, never
    // persist a browser session cookie into the WebView while returning s2.
    headers.delete("Set-Cookie");
    return Response.json({session: upgraded.token, expires_at: upgraded.expiresAt}, {
      status: response.status,
      headers,
    });
  } catch {
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.delete("Set-Cookie");
    headers.set("Cache-Control", "no-store");
    return new Response("Authentication unavailable", {status: 503, headers});
  }
}

async function acceptedReportWithPendingBlock(response: Response): Promise<Response> {
  await response.body?.cancel().catch(() => {});
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("Cache-Control", "no-store");
  return Response.json({status: "received", block: "pending"}, {status: 202, headers});
}

async function nativeReportAndBlock(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "";
  if (url.pathname !== NATIVE_REPORT_PATH || request.method !== "POST"
      || !NATIVE_ORIGINS.has(origin)) return null;

  // The lower Worker validates the room bearer, participant membership, report
  // schema, quotas, and durable inbox write. Only after that write returns 201
  // do we invalidate the private two-person room server-side. The client also
  // persists the current peer's pseudonymous safety id locally for future rooms.
  const response = await accountGuardEntry.fetch(request, env, ctx);
  if (response.status !== 201) return response;

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const room = ROOM_TOKEN_PATTERN.exec(token);
  if (!room) return acceptedReportWithPendingBlock(response);

  try {
    const closed = await env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(
      new Request("https://room.internal/close", {
        method: "POST", headers: {"X-Room-Expires": room[2]}
      })
    );
    // A concurrent host/moderator close is already the desired safety state.
    if (closed.ok || closed.status === 410) return response;
  } catch { /* durable report remains available to the moderator */ }

  // The report is already durable. Keep the client-side block/leave path on the
  // successful branch while accurately marking that server closure is pending.
  return acceptedReportWithPendingBlock(response);
}

async function routeRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const oauthSwitch = await browserOAuthAccountSwitchGuard(request, env, ctx);
  if (oauthSwitch) return oauthSwitch;
  const oauthCallback = await registeredBrowserOAuthCallback(request, env, ctx);
  if (oauthCallback) return oauthCallback;
  const bootstrap = await v2MobileBootstrap(request, env, ctx);
  if (bootstrap) return bootstrap;
  const handoff = await upgradedNativeHandoff(request, env, ctx);
  if (handoff) return handoff;
  const report = await nativeReportAndBlock(request, env, ctx);
  return report || accountGuardEntry.fetch(request, env, ctx);
}

async function withRoomClientScripts(request: Request, response: Response): Promise<Response> {
  if (response.webSocket || request.method !== "GET" || response.status >= 400) return response;
  const path = new URL(request.url).pathname;
  if (path !== "/room.html" && !path.startsWith("/room/")) return response;
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return response;

  const html = await response.clone().text();
  if (html.includes('/room-blocking.js')) return response;
  if (!html.includes(ROOM_RUNTIME_MARKER)) return response;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(html.replace(ROOM_RUNTIME_MARKER, ROOM_CLIENT_SCRIPTS), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const requestId = crypto.randomUUID();
    const started = performance.now();
    try {
      let response = await routeRequest(request, env, ctx);
      response = await withRoomClientScripts(request, response);
      const duration = performance.now() - started;
      if (response.status < 400) {
        logOperationalSuccess(operationalSuccessRecord(request, response.status, requestId, duration));
        // Successful responses—including WebSocket upgrades—are observed without
        // transport decoration. The room HTML adapter above is the one explicit
        // exception: it adds only same-origin, content-free room client scripts.
        return response;
      }
      const record = operationalFailureRecord(request, response.status, requestId, duration);
      logOperationalFailure(record);
      // Only ordinary HTTP failures are cloned for the diagnostic request id.
      return withFailureRequestId(response, requestId);
    } catch (error) {
      logOperationalException(operationalExceptionRecord(
        request, error, requestId, performance.now() - started
      ));
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;

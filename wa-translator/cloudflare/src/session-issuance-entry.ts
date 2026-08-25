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
import { inspectSessionToken, mintSessionV2 } from "./session-v2";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const NATIVE_HANDOFF_PATH = "/api/v1/auth/handoff";
const MOBILE_BOOTSTRAP_PATH = "/api/v1/mobile/bootstrap";
const NATIVE_REPORT_PATH = "/api/v1/reports";
const NATIVE_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const ROOM_TOKEN_PATTERN = /^([A-Za-z0-9_-]{24})\.(\d{10})\.[A-Za-z0-9_-]{43}$/;
const MOBILE_PROTOCOL = 2;
const ROOM_RUNTIME_MARKER = '<script src="/app-runtime.js"></script>';
const ROOM_PRODUCT_EVENTS = `${ROOM_RUNTIME_MARKER}\n<script src="/product-events.js"></script>\n<script src="/room-product-events.js"></script>`;

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
  // do we invalidate the private two-person room server-side. This gives the
  // installed app a real block boundary without inventing a persistent guest ID.
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
  const bootstrap = await v2MobileBootstrap(request, env, ctx);
  if (bootstrap) return bootstrap;
  const handoff = await upgradedNativeHandoff(request, env, ctx);
  if (handoff) return handoff;
  const report = await nativeReportAndBlock(request, env, ctx);
  return report || accountGuardEntry.fetch(request, env, ctx);
}

async function withRoomProductEvents(request: Request, response: Response): Promise<Response> {
  if (response.webSocket || request.method !== "GET" || response.status >= 400) return response;
  const path = new URL(request.url).pathname;
  if (path !== "/room.html" && !path.startsWith("/room/")) return response;
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return response;

  const html = await response.clone().text();
  if (html.includes('/room-product-events.js')) return response;
  if (!html.includes(ROOM_RUNTIME_MARKER)) return response;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(html.replace(ROOM_RUNTIME_MARKER, ROOM_PRODUCT_EVENTS), {
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
      response = await withRoomProductEvents(request, response);
      const duration = performance.now() - started;
      if (response.status < 400) {
        logOperationalSuccess(operationalSuccessRecord(request, response.status, requestId, duration));
        // Successful responses—including WebSocket upgrades—are observed without
        // transport decoration. The room HTML adapter above is the one explicit
        // exception: it adds only same-origin, content-free product-event scripts.
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

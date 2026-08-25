import accountGuardEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./account-guard-entry";
import { inspectSessionToken, mintSessionV2 } from "./session-v2";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const NATIVE_HANDOFF_PATH = "/api/v1/auth/handoff";
const MOBILE_BOOTSTRAP_PATH = "/api/v1/mobile/bootstrap";
const MOBILE_PROTOCOL = 2;

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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const bootstrap = await v2MobileBootstrap(request, env, ctx);
    if (bootstrap) return bootstrap;
    const handoff = await upgradedNativeHandoff(request, env, ctx);
    return handoff || accountGuardEntry.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

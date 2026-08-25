import launchEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./launch-entry";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const NATIVE_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const SESSION_COOKIE = "lr_s";
const ROOM_CREATE_PATHS = new Set(["/api/rooms", "/api/v1/rooms"]);

function nativeOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  return origin && NATIVE_ORIGINS.has(origin) ? origin : null;
}

function hasBrowserSession(request: Request): boolean {
  return (request.headers.get("Cookie") || "").split(";").some(pair =>
    pair.trim().startsWith(`${SESSION_COOKIE}=`)
  );
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function retiredRoomCreate(request: Request): Response | null {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/rooms") return null;
  // The original HTML-form redirect creator is no longer part of the shipping
  // dashboard. Keep one canonical creation API so account authority, quotas,
  // native adaptation and response contracts cannot drift across two host
  // entrypoints.
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function accountProbe(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = url.pathname === "/api/v1/rooms" ? "/api/v1/me" : "/api/me";
  url.search = "";
  const headers = new Headers(request.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Type");
  return new Request(url.toString(), {method: "GET", headers, redirect: "manual"});
}

function staleSessionResponse(request: Request): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  const native = new URL(request.url).pathname === "/api/v1/rooms" ? nativeOrigin(request) : null;
  if (native) {
    headers.set("Access-Control-Allow-Origin", native);
    headers.set("Vary", "Origin");
  } else {
    // Browser sessions are stateless signed cookies. If their account has been
    // deleted, expire the cookie immediately instead of letting it remain a
    // plausible host credential until its original 30-day token expiry.
    headers.append("Set-Cookie", clearSessionCookie());
  }
  return new Response("Account unavailable", {status: 401, headers});
}

async function accountGuardedRoomCreate(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || !ROOM_CREATE_PATHS.has(url.pathname)) return null;

  // Reuse the normal account endpoint rather than duplicating session crypto in
  // this outer entrypoint. That endpoint verifies the browser/native session and
  // consults UserDirectory, which is the authority for whether the account
  // still exists after deletion.
  const probe = await launchEntry.fetch(accountProbe(request), env, ctx);
  if (!probe.ok) return probe;
  let signedIn = false;
  try {
    const body = await probe.json() as {signed_in?: unknown};
    signedIn = body.signed_in === true;
  } catch {
    return new Response("Account unavailable", {
      status: 503,
      headers: {"Cache-Control": "no-store"},
    });
  }
  if (!signedIn) return staleSessionResponse(request);
  return launchEntry.fetch(request, env, ctx);
}

async function browserAccountSnapshot(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/api/me") return null;

  const response = await launchEntry.fetch(request, env, ctx);
  if (!response.ok || !hasBrowserSession(request)) return response;
  try {
    const body = await response.clone().json() as {signed_in?: unknown};
    if (body.signed_in !== false) return response;
  } catch {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.append("Set-Cookie", clearSessionCookie());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const retired = retiredRoomCreate(request);
    if (retired) return retired;
    const account = await browserAccountSnapshot(request, env, ctx);
    if (account) return account;
    const guarded = await accountGuardedRoomCreate(request, env, ctx);
    return guarded || launchEntry.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

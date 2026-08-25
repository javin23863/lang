import launchEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./launch-entry";
import { inspectSessionToken, mintSessionV2, type SessionIdentity } from "./session-v2";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const NATIVE_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const SESSION_COOKIE = "lr_s";
const ROOM_CREATE_PATHS = new Set(["/api/rooms", "/api/v1/rooms"]);
const ACCOUNT_DELETE_PATHS = new Set(["/api/account/delete", "/api/v1/account/delete"]);
const ACCOUNT_SNAPSHOT_PATHS = new Set(["/api/me", "/api/v1/me"]);
const LOGOUT_PATHS = new Set(["/auth/logout", "/api/v1/auth/logout"]);
const OAUTH_CALLBACK_PATTERN = /^\/auth\/(google|apple|facebook)\/callback$/;

function nativeOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  return origin && NATIVE_ORIGINS.has(origin) ? origin : null;
}

function expectedOrigin(request: Request, env: Env): string {
  return env.PUBLIC_ORIGIN || new URL(request.url).origin;
}

function sessionMutationOriginAllowed(request: Request, env: Env): boolean {
  return request.headers.get("Origin") === expectedOrigin(request, env)
    || nativeOrigin(request) !== null;
}

function readCookie(request: Request, name: string): string | null {
  for (const pair of (request.headers.get("Cookie") || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return null;
}

function browserSessionToken(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE);
}

function nativeSessionToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token && !token.includes(" ") ? token : null;
}

function requestSessionToken(request: Request): string | null {
  return new URL(request.url).pathname.startsWith("/api/v1/")
    ? nativeSessionToken(request) : browserSessionToken(request);
}

function hasBrowserSession(request: Request): boolean {
  return browserSessionToken(request) !== null;
}

async function sessionIdentity(request: Request, env: Env): Promise<SessionIdentity | null> {
  const token = requestSessionToken(request);
  return token ? inspectSessionToken(token, env.ROOM_SIGNING_KEY) : null;
}

function withLegacySession(request: Request, identity: SessionIdentity): Request {
  if (identity.version === 1) return request;
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  if (url.pathname.startsWith("/api/v1/")) {
    headers.set("Authorization", `Bearer ${identity.legacyToken}`);
  } else {
    const cookies = (headers.get("Cookie") || "").split(";").map(pair => pair.trim()).filter(pair => {
      if (!pair) return false;
      const separator = pair.indexOf("=");
      return separator <= 0 || pair.slice(0, separator).trim() !== SESSION_COOKIE;
    });
    cookies.push(`${SESSION_COOKIE}=${identity.legacyToken}`);
    headers.set("Cookie", cookies.join("; "));
  }
  return new Request(request, {headers});
}

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function setCookieValues(headers: Headers): string[] {
  return typeof headers.getSetCookie === "function"
    ? headers.getSetCookie() : [headers.get("Set-Cookie") || ""].filter(Boolean);
}

async function upgradeBrowserOAuthSession(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!OAUTH_CALLBACK_PATTERN.test(url.pathname)) return null;

  const response = await launchEntry.fetch(request, env, ctx);
  const cookies = setCookieValues(response.headers);
  const sessionIndex = cookies.findIndex(value => /^lr_s=s1\./.test(value));
  if (sessionIndex < 0) return response;

  const token = cookies[sessionIndex].slice(`${SESSION_COOKIE}=`.length).split(";")[0];
  try {
    const legacy = await inspectSessionToken(token, env.ROOM_SIGNING_KEY);
    if (!legacy || legacy.version !== 1) throw new Error("legacy callback session is invalid");
    const upgraded = await mintSessionV2(legacy.userId, env.ROOM_SIGNING_KEY, legacy.expiresAt);
    cookies[sessionIndex] = cookies[sessionIndex].replace(
      /^lr_s=[^;]+/, `${SESSION_COOKIE}=${upgraded.token}`
    );
    const headers = new Headers(response.headers);
    headers.delete("Set-Cookie");
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    // Never fall back to issuing the deterministic legacy bearer if v2 minting
    // fails. Preserve non-session cookie cleanup (notably spent OAuth state),
    // explicitly clear any session cookie, and fail closed.
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
  url.pathname = url.pathname.startsWith("/api/v1/") ? "/api/v1/me" : "/api/me";
  url.search = "";
  const headers = new Headers(request.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Type");
  return new Request(url.toString(), {method: "GET", headers, redirect: "manual"});
}

function responseHeaders(request: Request): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  const native = nativeOrigin(request);
  if (native) {
    headers.set("Access-Control-Allow-Origin", native);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function staleSessionResponse(request: Request): Response {
  const headers = responseHeaders(request);
  if (!nativeOrigin(request)) {
    // Browser sessions are signed cookies. A deleted/revoked credential is
    // retired immediately instead of remaining plausible until token expiry.
    headers.append("Set-Cookie", clearSessionCookie());
  }
  return new Response("Session unavailable", {status: 401, headers});
}

function sessionServiceUnavailable(request: Request): Response {
  return new Response("Session service unavailable", {status: 503, headers: responseHeaders(request)});
}

async function sessionRevoked(identity: SessionIdentity, env: Env): Promise<boolean> {
  const response = await env.USERS.get(env.USERS.idFromName(identity.userId)).fetch(
    new Request(`https://users.internal/session-revocations/${identity.digest}`)
  );
  const status = response.status;
  await response.body?.cancel().catch(() => {});
  if (status === 204) return true;
  if (status === 404) return false;
  throw new Error(`session revocation lookup failed (${status})`);
}

async function revokeSession(identity: SessionIdentity, env: Env): Promise<void> {
  const response = await env.USERS.get(env.USERS.idFromName(identity.userId)).fetch(
    new Request("https://users.internal/session-revocations", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({digest: identity.digest, expires_at: identity.expiresAt}),
    })
  );
  const status = response.status;
  await response.body?.cancel().catch(() => {});
  // A concurrent account deletion is stronger than a per-session revocation.
  if (status === 204 || status === 404) return;
  throw new Error(`session revocation write failed (${status})`);
}

async function signedInProbe(
  request: Request, env: Env, ctx: ExecutionContext, identity: SessionIdentity | null
): Promise<{response: Response; signedIn: boolean} | null> {
  const compatible = identity ? withLegacySession(request, identity) : request;
  const response = await launchEntry.fetch(accountProbe(compatible), env, ctx);
  if (!response.ok) return {response, signedIn: false};
  try {
    const body = await response.clone().json() as {signed_in?: unknown};
    return {response, signedIn: body.signed_in === true};
  } catch {
    await response.body?.cancel().catch(() => {});
    return null;
  }
}

async function accountGuardedMutation(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST"
      || (!ROOM_CREATE_PATHS.has(url.pathname) && !ACCOUNT_DELETE_PATHS.has(url.pathname))) {
    return null;
  }

  const identity = await sessionIdentity(request, env);
  // Reuse the normal account endpoint for account existence, but expose only a
  // verified legacy representation to the pre-v2 Worker. Revocation remains
  // keyed to the original external token above, so independently minted v2
  // sessions never collapse into the same logout identity.
  const probe = await signedInProbe(request, env, ctx, identity);
  if (!probe) return sessionServiceUnavailable(request);
  if (!probe.response.ok) return probe.response;
  if (!probe.signedIn) {
    await probe.response.body?.cancel().catch(() => {});
    return staleSessionResponse(request);
  }
  await probe.response.body?.cancel().catch(() => {});

  if (!identity) return staleSessionResponse(request);
  try {
    if (await sessionRevoked(identity, env)) return staleSessionResponse(request);
  } catch {
    return sessionServiceUnavailable(request);
  }
  return launchEntry.fetch(withLegacySession(request, identity), env, ctx);
}

async function signedOutSnapshot(
  request: Request, response: Response, providers: unknown
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  if (!nativeOrigin(request)) headers.append("Set-Cookie", clearSessionCookie());
  await response.body?.cancel().catch(() => {});
  return Response.json({
    signed_in: false,
    providers: Array.isArray(providers)
      ? providers.filter(provider => typeof provider === "string") : [],
  }, {status: 200, headers});
}

async function accountSnapshot(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || !ACCOUNT_SNAPSHOT_PATHS.has(url.pathname)) return null;

  const identity = await sessionIdentity(request, env);
  const compatible = identity ? withLegacySession(request, identity) : request;
  const response = await launchEntry.fetch(compatible, env, ctx);
  if (!response.ok) return response;
  let body: {signed_in?: unknown; providers?: unknown};
  try {
    body = await response.clone().json() as {signed_in?: unknown; providers?: unknown};
  } catch {
    return response;
  }

  if (body.signed_in !== true) {
    if (url.pathname === "/api/me" && hasBrowserSession(request)) {
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      headers.append("Set-Cookie", clearSessionCookie());
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }

  if (!identity) return sessionServiceUnavailable(request);
  try {
    if (!await sessionRevoked(identity, env)) return response;
  } catch {
    return sessionServiceUnavailable(request);
  }
  return signedOutSnapshot(request, response, body.providers);
}

async function revokingLogout(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || !LOGOUT_PATHS.has(url.pathname)) return null;
  // Do not let the revocation write turn an otherwise rejected cross-origin
  // logout attempt into a credential-denial side effect.
  if (!sessionMutationOriginAllowed(request, env)) return launchEntry.fetch(request, env, ctx);

  const identity = await sessionIdentity(request, env);
  const probe = await signedInProbe(request, env, ctx, identity);
  if (!probe) return sessionServiceUnavailable(request);
  if (!probe.response.ok) return probe.response;
  if (!probe.signedIn) {
    await probe.response.body?.cancel().catch(() => {});
    return launchEntry.fetch(request, env, ctx);
  }
  await probe.response.body?.cancel().catch(() => {});

  if (!identity) return staleSessionResponse(request);
  try {
    await revokeSession(identity, env);
  } catch {
    // Local credential clearing happens only after durable revocation succeeds;
    // otherwise the UI would report logout while a copied bearer stayed valid.
    return sessionServiceUnavailable(request);
  }
  return launchEntry.fetch(withLegacySession(request, identity), env, ctx);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const retired = retiredRoomCreate(request);
    if (retired) return retired;
    const oauth = await upgradeBrowserOAuthSession(request, env, ctx);
    if (oauth) return oauth;
    const account = await accountSnapshot(request, env, ctx);
    if (account) return account;
    const logout = await revokingLogout(request, env, ctx);
    if (logout) return logout;
    const guarded = await accountGuardedMutation(request, env, ctx);
    return guarded || launchEntry.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

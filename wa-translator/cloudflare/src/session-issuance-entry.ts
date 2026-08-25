import accountGuardEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./account-guard-entry";
import { inspectSessionToken, mintSessionV2 } from "./session-v2";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const NATIVE_HANDOFF_PATH = "/api/v1/auth/handoff";

async function upgradedNativeHandoff(
  request: Request, env: Env, ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== NATIVE_HANDOFF_PATH || request.method === "OPTIONS") return null;

  const response = await accountGuardEntry.fetch(request, env, ctx);
  if (!response.ok || request.method !== "POST") return response;

  try {
    const body = await response.clone().json() as {session?: unknown; expires_at?: unknown};
    if (typeof body.session !== "string") throw new Error("native session missing");
    const legacy = await inspectSessionToken(body.session, env.ROOM_SIGNING_KEY);
    if (!legacy || legacy.version !== 1) throw new Error("native legacy session invalid");
    const upgraded = await mintSessionV2(legacy.userId, env.ROOM_SIGNING_KEY, legacy.expiresAt);
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    return Response.json({session: upgraded.token, expires_at: upgraded.expiresAt}, {
      status: response.status,
      headers,
    });
  } catch {
    await response.body?.cancel().catch(() => {});
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.set("Cache-Control", "no-store");
    return new Response("Authentication unavailable", {status: 503, headers});
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const handoff = await upgradedNativeHandoff(request, env, ctx);
    return handoff || accountGuardEntry.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

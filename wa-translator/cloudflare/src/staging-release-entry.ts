import sessionIssuanceEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./session-issuance-entry";
import type { Env as WorkerEnv } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

type Env = WorkerEnv & { RELEASE_SHA?: string };

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_IDENTITY_PATHS = new Set([
  "/api/capabilities",
  "/api/v1/capabilities",
  "/api/v1/mobile/bootstrap",
]);

function unavailable(response?: Response): Response {
  const headers = new Headers(response?.headers);
  headers.delete("Content-Length");
  headers.set("Cache-Control", "no-store");
  return new Response("Staging release identity unavailable", { status: 503, headers });
}

async function withReleaseIdentity(
  request: Request,
  response: Response,
  env: Env,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method !== "GET" || !RELEASE_IDENTITY_PATHS.has(pathname)) return response;
  if (!RELEASE_SHA_PATTERN.test(env.RELEASE_SHA || "")) {
    await response.body?.cancel().catch(() => {});
    return unavailable(response);
  }
  if (!response.ok || response.webSocket) return response;
  try {
    const body = await response.json<Record<string, unknown>>();
    body.release_sha = env.RELEASE_SHA;
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.set("Cache-Control", "no-store");
    return Response.json(body, { status: response.status, headers });
  } catch {
    await response.body?.cancel().catch(() => {});
    return unavailable(response);
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const response = await sessionIssuanceEntry.fetch(request, env, ctx);
    return withReleaseIdentity(request, response, env);
  },
} satisfies ExportedHandler<Env>;

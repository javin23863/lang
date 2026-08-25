import mobileEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./mobile-entry";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const HTML_ISOLATION_POLICY = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const FOUR_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 4 people<';
const TWO_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 2 people<';

function isRoomPath(pathname: string): boolean {
  return pathname === "/room.html" || pathname.startsWith("/room/");
}

async function hardenHtml(request: Request, response: Response): Promise<Response> {
  if (response.webSocket) return response;
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return response;

  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", HTML_ISOLATION_POLICY);
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");

  const room = isRoomPath(new URL(request.url).pathname);
  headers.set("Permissions-Policy", room
    ? "camera=(self), microphone=(self)"
    : "camera=(), microphone=()");

  if (room && request.method === "GET" && response.ok) {
    // The live renderer already uses the strict two-person contract. Normalize
    // the server-rendered fallback too so slow JavaScript can never flash `/4`.
    const html = (await response.text()).replace(FOUR_PERSON_FALLBACK, TWO_PERSON_FALLBACK);
    headers.delete("Content-Length");
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return hardenHtml(request, await mobileEntry.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;

import mobileEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./mobile-entry";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const HTML_ISOLATION_POLICY = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const FOUR_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 4 people<';
const TWO_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 2 people<';

function isRoomPath(pathname: string): boolean {
  return pathname === "/room.html" || pathname.startsWith("/room/");
}

function isRoomShell(html: string): boolean {
  return html.includes('id="roleGate"') && html.includes('id="participantCount"');
}

async function hardenHtml(request: Request, response: Response): Promise<Response> {
  if (response.webSocket) return response;
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return response;

  // Materialize HTML instead of transplanting a fixed-length asset stream into
  // a new Response. Workerd can otherwise retain the original length contract
  // while the wrapper changes headers/body handling and cancel the request.
  const sourceHtml = await response.text();
  const room = isRoomPath(new URL(request.url).pathname) || isRoomShell(sourceHtml);
  const html = room ? sourceHtml.replace(FOUR_PERSON_FALLBACK, TWO_PERSON_FALLBACK) : sourceHtml;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("Content-Security-Policy", HTML_ISOLATION_POLICY);
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Permissions-Policy", room
    ? "camera=(self), microphone=(self)"
    : "camera=(), microphone=()");

  return new Response(html, {
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

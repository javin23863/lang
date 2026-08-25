import roomSource from "../../windows/static/room.html";
import mobileEntry, { AbuseGate, ReportInbox, Room, UserDirectory } from "./mobile-entry";
import type { Env } from "./worker";

export { AbuseGate, ReportInbox, Room, UserDirectory };

const HTML_ISOLATION_POLICY = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const ROOM_CONTENT_POLICY = `${HTML_ISOLATION_POLICY}; style-src 'self'; script-src 'self'`;
const FOUR_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 4 people<';
const TWO_PERSON_FALLBACK = 'id="participantCount" aria-live="polite">0 / 2 people<';
const ROOM_STYLE_PATTERN = /<style>\n([\s\S]*?)\n<\/style>/;
const ROOM_SCRIPT_PATTERN = /<script>\n(const \$ = \(id\) => document\.getElementById\(id\);[\s\S]*?)\n<\/script>\n<\/body>/;

type RoomAssets = { shell: string; css: string; js: string };

function decomposeRoom(source: string): RoomAssets {
  const style = source.match(ROOM_STYLE_PATTERN);
  const script = source.match(ROOM_SCRIPT_PATTERN);
  if (!style || !script) throw new Error("room source decomposition seam is missing");
  const shell = source
    .replace(style[0], '<link rel="stylesheet" href="/room.css">')
    .replace(script[0], '<script src="/room.js"></script>\n</body>');
  return { shell, css: `${style[1]}\n`, js: `${script[1]}\n` };
}

const canonicalRoom = decomposeRoom(roomSource);

function isRoomPath(pathname: string): boolean {
  return pathname === "/room.html" || pathname.startsWith("/room/");
}

function isRoomShell(html: string): boolean {
  return html.includes('id="roleGate"') && html.includes('id="participantCount"');
}

function roomAsset(pathname: string): Response | null {
  const content = pathname === "/room.css" ? canonicalRoom.css
    : pathname === "/room.js" ? canonicalRoom.js : null;
  if (content === null) return null;
  return new Response(content, {headers: {
    "Cache-Control": "no-store",
    "Content-Type": pathname.endsWith(".css") ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  }});
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
  const html = room
    ? decomposeRoom(sourceHtml).shell.replace(FOUR_PERSON_FALLBACK, TWO_PERSON_FALLBACK)
    : sourceHtml;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("Content-Security-Policy", room ? ROOM_CONTENT_POLICY : HTML_ISOLATION_POLICY);
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
    const asset = roomAsset(new URL(request.url).pathname);
    if (asset && request.method === "GET") return asset;
    return hardenHtml(request, await mobileEntry.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;

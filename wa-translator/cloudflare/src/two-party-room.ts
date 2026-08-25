import { Room as WorkerRoom, type Env } from "./worker";

export const PARTICIPANT_LIMIT = 2;
const COMPUTE_FETCH_TIMEOUT_MS = 30_000;

type RoomBaseShape = {
  ctx: DurableObjectState;
  env: Env;
  fetch(request: Request): Promise<Response>;
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void>;
  webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void>;
  webSocketError(socket: WebSocket): Promise<void>;
};

// The original room implementation predates the final two-person product
// decision and owns private send()/computeFetch() helpers. Cast only the
// inheritance surface so this wrapper can replace those runtime methods without
// duplicating the room protocol, metering, signalling, quotas, or lifecycle.
const RoomBase = WorkerRoom as unknown as new (...args: any[]) => RoomBaseShape;

type SocketAttachment = { joined?: unknown } | null;

function withTwoPartyLimit(message: object): object {
  const value = {...message} as Record<string, unknown>;
  if ("participant_limit" in value) value.participant_limit = PARTICIPANT_LIMIT;
  if (value.type === "room_full") value.limit = PARTICIPANT_LIMIT;
  return value;
}

export class Room extends RoomBase {
  private joinedCount(): number {
    return this.ctx.getWebSockets("browser").filter(socket => {
      const value = socket.deserializeAttachment() as SocketAttachment;
      return value?.joined === true;
    }).length;
  }

  // WorkerRoom's private helper is ordinary prototype dispatch at runtime. All
  // welcome, peer_join, peer_leave, presence, room_full, caption and signal
  // output therefore passes through this method without copying its protocol.
  private send(socket: WebSocket, message: object): void {
    try {
      socket.send(JSON.stringify(withTwoPartyLimit(message)));
    } catch {
      socket.close(1011, "send failed");
    }
  }

  // A dead upstream handshake must eventually re-enter WorkerRoom's existing
  // failure/backoff path instead of leaving one participant in `connecting`
  // forever. Preserve any shorter caller timeout (chat uses eight seconds) and
  // cap only the otherwise-unbounded network/upgrade attempt.
  private computeFetch(request: Request): Promise<Response> {
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(COMPUTE_FETCH_TIMEOUT_MS),
    ]);
    const bounded = new Request(request, {signal});
    return this.env.MODAL_TEST ? this.env.MODAL_TEST.fetch(bounded) : fetch(bounded);
  }

  async fetch(request: Request): Promise<Response> {
    const response = await super.fetch(request);
    if (response.webSocket || !response.ok) return response;
    const path = new URL(request.url).pathname;
    if (path !== "/host-status" && path !== "/close") return response;
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) return response;
    const body = await response.json<Record<string, unknown>>();
    if ("participant_limit" in body) body.participant_limit = PARTICIPANT_LIMIT;
    const headers = new Headers(response.headers);
    // The JSON body changed. Reusing an upstream Content-Length would turn the
    // replacement response into a FixedLengthStream with the wrong byte count.
    headers.delete("Content-Length");
    return Response.json(body, {status: response.status, headers});
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // A legitimate join is tiny. Large control frames go directly to the base
    // implementation so its existing byte caps reject them before JSON parse.
    if (typeof message === "string" && message.length <= 4096) {
      try {
        const value = JSON.parse(message) as unknown;
        const attachment = socket.deserializeAttachment() as SocketAttachment;
        if (value && typeof value === "object" && !Array.isArray(value)
            && (value as Record<string, unknown>).type === "join"
            && attachment?.joined !== true && this.joinedCount() >= PARTICIPANT_LIMIT) {
          this.send(socket, {
            type: "room_full",
            limit: PARTICIPANT_LIMIT,
            participant_count: PARTICIPANT_LIMIT,
          });
          socket.close(1013, "room full");
          return;
        }
      } catch {
        // WorkerRoom owns invalid-control-message handling. Only a valid join
        // needs the early capacity check above.
      }
    }
    await super.webSocketMessage(socket, message);
  }
}

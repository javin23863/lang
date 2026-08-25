import { Room as WorkerRoom, type Env } from "./worker";

export const PARTICIPANT_LIMIT = 2;
const COMPUTE_FETCH_TIMEOUT_MS = 30_000;
const PRESENCE_LEASE_MS = 90_000;
const USAGE_PENDING_KEY = "usagePendingV1";
const USAGE_RETRY_MS = 5 * 60 * 1000;
const ALARM_FLOOR_MS = 1_000;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const BLOCK_LIST_LIMIT = 128;

type RoomBaseShape = {
  ctx: DurableObjectState;
  env: Env;
  fetch(request: Request): Promise<Response>;
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void>;
  webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void>;
  webSocketError(socket: WebSocket): Promise<void>;
  alarm(): Promise<void>;
};

// The original room implementation predates the final two-person product
// decision and owns private send()/computeFetch()/flushUsage() helpers. Cast
// only the inheritance surface so this wrapper can replace those runtime
// methods without duplicating the room protocol, signalling, quotas, or media
// lifecycle.
const RoomBase = WorkerRoom as unknown as new (...args: any[]) => RoomBaseShape;

type SocketAttachment = {
  id?: unknown;
  joined?: unknown;
  lastSeenAt?: unknown;
  blockId?: unknown;
  blockedIds?: unknown;
} | null;
type RoomUsage = { callMs: number; chat: number; tts: number };
type PendingUsage = RoomUsage & { deliveryId: string };
type UsageKind = "call" | "chat" | "tts";
type UsageSnapshot = { usage: PendingUsage; wasPending: boolean };

const EMPTY_USAGE: RoomUsage = {callMs: 0, chat: 0, tts: 0};

function withTwoPartyLimit(message: object): Record<string, unknown> {
  const value = {...message} as Record<string, unknown>;
  if ("participant_limit" in value) value.participant_limit = PARTICIPANT_LIMIT;
  if (value.type === "room_full") value.limit = PARTICIPANT_LIMIT;
  return value;
}

function usageEmpty(usage: RoomUsage): boolean {
  return usage.callMs <= 0 && usage.chat <= 0 && usage.tts <= 0;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function usageDeliveryId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(8)));
}

function fallbackBlockId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

function blockList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > BLOCK_LIST_LIMIT) return null;
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !BLOCK_ID_PATTERN.test(item)) return null;
    unique.add(item);
  }
  return [...unique];
}

async function roomUsageRef(roomId: string): Promise<string> {
  return base64url(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(roomId)
  )).slice(0, 16);
}

export class Room extends RoomBase {
  private usageFlush: Promise<void> | null = null;

  private joinedAttachments(now = Date.now()): SocketAttachment[] {
    return this.ctx.getWebSockets("browser").flatMap(socket => {
      const value = socket.deserializeAttachment() as SocketAttachment;
      return value?.joined === true
        && typeof value.lastSeenAt === "number"
        && Number.isFinite(value.lastSeenAt)
        && now - value.lastSeenAt < PRESENCE_LEASE_MS ? [value] : [];
    });
  }

  private joinedCount(now = Date.now()): number {
    return this.joinedAttachments(now).length;
  }

  private blockIdForParticipant(id: unknown): string | null {
    if (typeof id !== "string") return null;
    for (const value of this.joinedAttachments()) {
      if (value?.id === id && typeof value.blockId === "string"
          && BLOCK_ID_PATTERN.test(value.blockId)) return value.blockId;
    }
    return null;
  }

  private withParticipantBlockId(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = {...value as Record<string, unknown>};
    const blockId = this.blockIdForParticipant(record.id);
    if (blockId) record.block_id = blockId;
    return record;
  }

  private withSafetyContract(message: object): Record<string, unknown> {
    const value = withTwoPartyLimit(message);
    if (value.type === "welcome" && Array.isArray(value.peers)) {
      value.peers = value.peers.map(peer => this.withParticipantBlockId(peer));
    } else if (value.type === "peer_join" || value.type === "peer_update") {
      const enriched = this.withParticipantBlockId(value);
      if (enriched && typeof enriched === "object" && !Array.isArray(enriched)) {
        return enriched as Record<string, unknown>;
      }
    } else if (value.type === "signal") {
      const blockId = this.blockIdForParticipant(value.from);
      if (blockId) value.from_block_id = blockId;
    } else if (value.type === "caption" || value.type === "chat") {
      const blockId = this.blockIdForParticipant(value.speaker);
      if (blockId) value.speaker_block_id = blockId;
    }
    return value;
  }

  private blockedRelationship(blockId: string, blockedIds: string[]): boolean {
    for (const peer of this.joinedAttachments()) {
      const peerBlockId = typeof peer?.blockId === "string" && BLOCK_ID_PATTERN.test(peer.blockId)
        ? peer.blockId : null;
      const peerBlockedIds = Array.isArray(peer?.blockedIds)
        ? peer.blockedIds.filter((item): item is string =>
          typeof item === "string" && BLOCK_ID_PATTERN.test(item)) : [];
      if ((peerBlockId && blockedIds.includes(peerBlockId)) || peerBlockedIds.includes(blockId)) {
        return true;
      }
    }
    return false;
  }

  // WorkerRoom's private helper is ordinary prototype dispatch at runtime. All
  // welcome, peer_join, peer_leave, presence, room_full, caption and signal
  // output therefore passes through this method without copying its protocol.
  private send(socket: WebSocket, message: object): void {
    try {
      socket.send(JSON.stringify(this.withSafetyContract(message)));
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

  private async settleCallUsage(): Promise<void> {
    if (this.joinedCount() > 0) return;
    const activeSince = await this.ctx.storage.get<number>("activeSince");
    if (activeSince === undefined) return;
    await this.ctx.storage.delete("activeSince");
    const usage = await this.ctx.storage.get<RoomUsage>("usage") || {...EMPTY_USAGE};
    usage.callMs += Math.max(0, Date.now() - activeSince);
    await this.ctx.storage.put("usage", usage);
  }

  private async claimUsageSnapshot(): Promise<UsageSnapshot | null> {
    return this.ctx.storage.transaction(async transaction => {
      const existing = await transaction.get<PendingUsage>(USAGE_PENDING_KEY);
      if (existing) {
        // A pending snapshot written by the previous wrapper revision has no
        // delivery id. Upgrade it in place before any retry so every account
        // write from this revision has a stable idempotency key.
        if (!DELIVERY_ID_PATTERN.test(existing.deliveryId || "")) {
          existing.deliveryId = usageDeliveryId();
          await transaction.put(USAGE_PENDING_KEY, existing);
        }
        return {usage: {...existing}, wasPending: true};
      }
      const active = await transaction.get<RoomUsage>("usage");
      if (!active || usageEmpty(active)) return null;
      const pending: PendingUsage = {...active, deliveryId: usageDeliveryId()};
      await transaction.put(USAGE_PENDING_KEY, pending);
      await transaction.put("usage", {...EMPTY_USAGE});
      return {usage: {...pending}, wasPending: false};
    });
  }

  private async reconcileUsageAlarm(retry: boolean): Promise<void> {
    const expiresAt = await this.ctx.storage.get<number>("expiresAt");
    if (!Number.isSafeInteger(expiresAt)) return;
    const now = Date.now();
    const expiryMs = expiresAt! * 1000;
    if (expiryMs <= now) return;
    const target = retry ? Math.min(expiryMs, now + USAGE_RETRY_MS) : expiryMs;
    await this.ctx.storage.setAlarm(Math.max(now + ALARM_FLOOR_MS, target));
  }

  private flushUsage(): Promise<void> {
    // Last-socket close and host close can arrive close together. Serialize the
    // delivery side so one pending snapshot cannot be sent twice by concurrent
    // flush calls on the same live Durable Object instance.
    if (this.usageFlush) return this.usageFlush;
    const operation = (async () => {
      const retry = await this.flushUsageOnce();
      // A transient account-object failure gets another chance inside the
      // existing room lifetime. Success restores the room's original expiry
      // alarm. Nothing here can extend storage beyond that expiry.
      await this.reconcileUsageAlarm(retry);
    })().finally(() => {
      if (this.usageFlush === operation) this.usageFlush = null;
    });
    this.usageFlush = operation;
    return operation;
  }

  private async flushUsageOnce(): Promise<boolean> {
    await this.settleCallUsage();
    const owner = await this.ctx.storage.get<string>("owner");
    if (!owner) return false;

    const roomRef = await roomUsageRef(this.ctx.id.name || "");
    const stub = this.env.USERS.get(this.env.USERS.idFromName(owner));

    // At most two snapshots are relevant to one idle-room flush: an older
    // durable backlog plus the active counters that accumulated while that
    // backlog was waiting. If the room has been rejoined, a retry delivers only
    // the old backlog and leaves the new active call counters untouched.
    for (let pass = 0; pass < 2; pass++) {
      const snapshot = await this.claimUsageSnapshot();
      if (!snapshot) return false;
      const pending = snapshot.usage;
      if (usageEmpty(pending)) {
        await this.ctx.storage.delete(USAGE_PENDING_KEY);
        if (snapshot.wasPending && pass === 0 && this.joinedCount() === 0) continue;
        return false;
      }

      const deliveries: Array<[UsageKind, number]> = [
        ["call", pending.callMs > 0 ? Math.ceil(pending.callMs / 60_000) : 0],
        ["chat", pending.chat],
        ["tts", pending.tts],
      ];

      for (const [kind, units] of deliveries) {
        if (units <= 0) continue;
        const deliveryId = `u1.${roomRef}.${pending.deliveryId}.${kind}`;
        let response: Response;
        try {
          response = await stub.fetch(new Request("https://users.internal/usage", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({kind, units, room_ref: roomRef, delivery_id: deliveryId}),
          }));
        } catch {
          return true; // pending storage remains intact for the retry alarm
        }
        const status = response.status;
        await response.body?.cancel().catch(() => {});

        // A missing profile is authoritative account deletion, not a transient
        // delivery failure. Drop both pending and newly accumulated counters so
        // room activity can never recreate usage for an erased account.
        if (status === 404) {
          await this.ctx.storage.transaction(async transaction => {
            await transaction.delete(USAGE_PENDING_KEY);
            await transaction.put("usage", {...EMPTY_USAGE});
          });
          return false;
        }
        if (status < 200 || status >= 300) return true;

        if (kind === "call") pending.callMs = 0;
        else pending[kind] = 0;
        if (usageEmpty(pending)) await this.ctx.storage.delete(USAGE_PENDING_KEY);
        else await this.ctx.storage.put(USAGE_PENDING_KEY, {...pending});
      }

      if (!snapshot.wasPending || this.joinedCount() > 0) return false;
    }
    return false;
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
            && attachment !== null && attachment.joined !== true) {
          const join = value as Record<string, unknown>;
          if (join.block_id !== undefined
              && (typeof join.block_id !== "string" || !BLOCK_ID_PATTERN.test(join.block_id))) {
            socket.close(1008, "invalid participant safety id");
            return;
          }
          const blockedIds = blockList(join.blocked_ids);
          if (!blockedIds) {
            socket.close(1008, "invalid participant block list");
            return;
          }
          const blockId = typeof join.block_id === "string" ? join.block_id : fallbackBlockId();
          if (this.blockedRelationship(blockId, blockedIds)) {
            this.send(socket, {type: "peer_blocked"});
            socket.close(1008, "participant blocked");
            return;
          }
          attachment.blockId = blockId;
          attachment.blockedIds = blockedIds;
          socket.serializeAttachment(attachment);

          if (this.joinedCount() >= PARTICIPANT_LIMIT) {
            this.send(socket, {
              type: "room_full",
              limit: PARTICIPANT_LIMIT,
              participant_count: PARTICIPANT_LIMIT,
            });
            socket.close(1013, "room full");
            return;
          }
        }
      } catch {
        // WorkerRoom owns invalid-control-message handling. Only a valid join
        // needs the early product-contract checks above.
      }
    }
    await super.webSocketMessage(socket, message);
  }

  async alarm(): Promise<void> {
    const expiresAt = await this.ctx.storage.get<number>("expiresAt");
    if (Number.isSafeInteger(expiresAt) && Date.now() < expiresAt! * 1000) {
      // This is a usage-delivery retry alarm, not room expiry. Retry without
      // touching sockets or room state; flushUsage restores expiry or schedules
      // the next bounded retry depending on the delivery result.
      await this.flushUsage();
      return;
    }
    await super.alarm();
  }
}

import { UserDirectory as WorkerUserDirectory } from "./worker";

const DELIVERY_PATTERN = /^u1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{11})\.(call|chat|tts)$/;
const DELIVERY_MARKER_PREFIX = "delivery:";
const DELIVERY_RETENTION_MS = 48 * 60 * 60 * 1000;
const ALARM_FLOOR_MS = 1_000;

type UserTotals = {call_minutes: number; chat_messages: number; tts_phrases: number};
type UsageRecord = {at: string; kind: string; units: number; room_ref: string};
type DeliveryMarker = {createdAt: number};

const EMPTY_TOTALS: UserTotals = {call_minutes: 0, chat_messages: 0, tts_phrases: 0};
const TOTAL_FIELD = new Map([
  ["call", "call_minutes"], ["chat", "chat_messages"], ["tts", "tts_phrases"],
] as const);

// Keep the existing Durable Object class name/migration while retiring the
// zero-only credits preview and adding retry-safe usage delivery. The base
// object remains compatible with rooms from the previous deployment revision;
// current rooms include delivery_id and take the atomic path below.
export class UserDirectory extends WorkerUserDirectory {
  private async pruneDeliveryMarkers(): Promise<void> {
    const now = Date.now();
    const markers = await this.ctx.storage.list<DeliveryMarker>({prefix: DELIVERY_MARKER_PREFIX});
    const expired = [...markers].filter(([, marker]) =>
      !Number.isSafeInteger(marker.createdAt) || marker.createdAt + DELIVERY_RETENTION_MS <= now
    );
    if (expired.length) await this.ctx.storage.delete(expired.map(([key]) => key));
    for (const [key] of expired) markers.delete(key);

    // The base object owns the 90-day usage-row alarm. A delivery marker only
    // needs to outlive the 24-hour room retry window, so move the shared alarm
    // earlier when necessary but never later than the base retention alarm.
    if (markers.size) {
      const earliest = Math.min(...[...markers.values()].map(
        marker => marker.createdAt + DELIVERY_RETENTION_MS
      ));
      const existing = await this.ctx.storage.getAlarm();
      if (existing === null || earliest < existing) {
        await this.ctx.storage.setAlarm(Math.max(now + ALARM_FLOOR_MS, earliest));
      }
    }
  }

  private async idempotentUsage(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/usage") return null;

    let data: Record<string, unknown>;
    try {
      const parsed = await request.clone().json<unknown>();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      data = parsed as Record<string, unknown>;
    } catch {
      return null; // let the base object return its normal invalid-request error
    }
    if (!("delivery_id" in data)) return null; // rolling-deploy compatibility

    const deliveryId = typeof data.delivery_id === "string" ? data.delivery_id : "";
    const match = deliveryId.match(DELIVERY_PATTERN);
    const kind = typeof data.kind === "string" ? data.kind : "";
    const units = data.units;
    const roomRef = typeof data.room_ref === "string" ? data.room_ref : "";
    if (Object.keys(data).sort().join(",") !== "delivery_id,kind,room_ref,units"
        || !match || match[1] !== roomRef || match[3] !== kind
        || !TOTAL_FIELD.has(kind as "call" | "chat" | "tts")
        || typeof units !== "number" || !Number.isSafeInteger(units)
        || units < 1 || units > 100_000) {
      return new Response("Invalid usage", {status: 400});
    }

    const totalField = TOTAL_FIELD.get(kind as "call" | "chat" | "tts")!;
    const now = Date.now();
    const at = new Date(now).toISOString();
    const markerKey = `${DELIVERY_MARKER_PREFIX}${deliveryId}`;
    const usageKey = `usage:${now}-${deliveryId.replaceAll(".", "_")}`;
    const outcome = await this.ctx.storage.transaction(async transaction => {
      if (await transaction.get<DeliveryMarker>(markerKey)) return "duplicate" as const;
      if (!await transaction.get("profile")) return "missing" as const;

      const totals = await transaction.get<UserTotals>("totals") || {...EMPTY_TOTALS};
      totals[totalField] += units;
      const row: UsageRecord = {at, kind, units, room_ref: roomRef};
      await transaction.put("totals", totals);
      await transaction.put(usageKey, row);
      await transaction.put(markerKey, {createdAt: now});
      return "stored" as const;
    });

    if (outcome === "missing") return new Response("Not found", {status: 404});
    await this.ctx.storage.delete("credits");

    if (outcome === "stored") {
      // Reuse the base GET solely to run its proven 90-day/200-row retention
      // sweep and alarm logic. The response never leaves the Durable Object.
      const retained = await super.fetch(new Request("https://users.internal/"));
      await retained.body?.cancel().catch(() => {});
    }
    await this.pruneDeliveryMarkers();
    return new Response(null, {status: 204});
  }

  async fetch(request: Request): Promise<Response> {
    const idempotent = await this.idempotentUsage(request);
    if (idempotent) return idempotent;

    const url = new URL(request.url);
    const accountRoot = url.pathname === "/";
    const response = await super.fetch(request);

    // Root profile reads/writes and legacy /usage writes are all account
    // activity. An old zero-only balance should disappear on whichever
    // successful operation happens first rather than waiting for /api/me.
    if (response.ok && (request.method === "GET" || request.method === "POST")) {
      await this.ctx.storage.delete("credits");
      await this.pruneDeliveryMarkers();
    }
    if (!(accountRoot && request.method === "GET" && response.ok)) return response;

    const body = await response.json<Record<string, unknown>>();
    delete body.credits;
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    return Response.json(body, {status: response.status, headers});
  }

  async alarm(): Promise<void> {
    await super.alarm();
    await this.pruneDeliveryMarkers();
  }
}

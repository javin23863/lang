import { ReportInbox as WorkerReportInbox } from "./worker";

const REPORT_KEY_PREFIX = "report:";
const ALARM_FLOOR_MS = 1_000;
const REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ROUTING_LIFETIME_SECONDS = 24 * 60 * 60;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;

type StoredReportShape = Record<string, unknown> & {
  created_at?: unknown;
  room_id?: unknown;
  room_expires?: unknown;
};

function withoutRouting(value: StoredReportShape): StoredReportShape {
  const retained = {...value};
  delete retained.room_id;
  delete retained.room_expires;
  return retained;
}

// The category-only moderation record is retained for its documented 30-day
// window, but its internal room routing ID is useful only while that room can
// still be closed. Keep the existing Durable Object class/migration and enforce
// both ceilings at this wrapper so direct resolve requests cannot bypass a
// delayed retention alarm.
export class ReportInbox extends WorkerReportInbox {
  private async pruneRetentionAndRouting(): Promise<void> {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const cutoffMs = nowMs - REPORT_RETENTION_MS;
    const rows = await this.ctx.storage.list<StoredReportShape>({prefix: REPORT_KEY_PREFIX});
    let nextRoomExpiryMs: number | null = null;

    for (const [key, value] of rows) {
      const createdAt = typeof value.created_at === "string" ? Date.parse(value.created_at) : NaN;
      // The base inbox writes server-generated ISO timestamps. Missing,
      // malformed, future, or over-retention timestamps are not trustworthy
      // moderation records and are deleted rather than allowed to live longer.
      if (!Number.isFinite(createdAt) || createdAt > nowMs || createdAt < cutoffMs) {
        await this.ctx.storage.delete(key);
        continue;
      }

      const hasRouting = "room_id" in value || "room_expires" in value;
      if (!hasRouting) continue;
      const expires = typeof value.room_expires === "number"
        && Number.isSafeInteger(value.room_expires) ? value.room_expires : null;
      const validRoomId = typeof value.room_id === "string" && ROOM_ID_PATTERN.test(value.room_id);
      const validLifetime = expires !== null
        && expires <= nowSeconds + MAX_ROUTING_LIFETIME_SECONDS;

      // Corrupt/legacy routing metadata is less useful than no routing metadata
      // and must not outlive the privacy bound simply because its expiry cannot
      // be trusted. Fail closed by retaining only the category record.
      if (!validRoomId || !validLifetime || expires! <= nowSeconds) {
        await this.ctx.storage.put(key, withoutRouting(value));
        continue;
      }
      const expiryMs = expires! * 1000;
      nextRoomExpiryMs = nextRoomExpiryMs === null
        ? expiryMs : Math.min(nextRoomExpiryMs, expiryMs);
    }

    // The base inbox owns the 30-day deletion alarm. Only move that alarm
    // earlier when routing metadata has an earlier useful lifetime; never move
    // it later or delete it here.
    if (nextRoomExpiryMs !== null) {
      const existing = await this.ctx.storage.getAlarm();
      if (existing === null || nextRoomExpiryMs < existing) {
        await this.ctx.storage.setAlarm(Math.max(nowMs + ALARM_FLOOR_MS, nextRoomExpiryMs));
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.pruneRetentionAndRouting();

    const resolve = new URL(request.url).pathname.match(/^\/resolve\/([A-Za-z0-9_-]{22})$/);
    if (request.method === "GET" && resolve) {
      const report = await this.ctx.storage.get<StoredReportShape>(`${REPORT_KEY_PREFIX}${resolve[1]}`);
      const expires = report?.room_expires;
      if (!report || typeof report.room_id !== "string" || !ROOM_ID_PATTERN.test(report.room_id)
          || typeof expires !== "number" || !Number.isSafeInteger(expires)
          || expires <= Math.floor(Date.now() / 1000)) {
        return new Response("Not found", {status: 404});
      }
    }

    const response = await super.fetch(request);
    // The base inbox recalculates its own 30-day alarm on list and insert paths.
    // Always reconcile afterwards so that work cannot accidentally postpone an
    // earlier routing-data expiry back to the longer report-retention deadline.
    await this.pruneRetentionAndRouting();
    return response;
  }

  async alarm(): Promise<void> {
    // Let the base inbox delete 30-day records first, then restore the earlier
    // of its next retention alarm and any remaining room-routing expiry.
    await super.alarm();
    await this.pruneRetentionAndRouting();
  }
}

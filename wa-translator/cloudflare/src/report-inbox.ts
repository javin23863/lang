import { ReportInbox as WorkerReportInbox } from "./worker";

const REPORT_KEY_PREFIX = "report:";
const ALARM_FLOOR_MS = 1_000;

type StoredReportShape = Record<string, unknown> & {
  room_id?: unknown;
  room_expires?: unknown;
};

// The category-only moderation record is retained for its documented 30-day
// window, but its internal room routing ID is useful only while that room can
// still be closed. Keep the existing Durable Object class/migration and trim
// just those routing fields when the 24-hour room lifetime ends.
export class ReportInbox extends WorkerReportInbox {
  private async pruneExpiredRouting(): Promise<void> {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const rows = await this.ctx.storage.list<StoredReportShape>({prefix: REPORT_KEY_PREFIX});
    let nextRoomExpiryMs: number | null = null;

    for (const [key, value] of rows) {
      const expires = typeof value.room_expires === "number"
        && Number.isSafeInteger(value.room_expires) ? value.room_expires : null;
      if (expires === null) continue;
      if (expires <= nowSeconds) {
        const retained = {...value};
        delete retained.room_id;
        delete retained.room_expires;
        await this.ctx.storage.put(key, retained);
        continue;
      }
      const expiryMs = expires * 1000;
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
    await this.pruneExpiredRouting();

    const resolve = new URL(request.url).pathname.match(/^\/resolve\/([A-Za-z0-9_-]{22})$/);
    if (request.method === "GET" && resolve) {
      const report = await this.ctx.storage.get<StoredReportShape>(`${REPORT_KEY_PREFIX}${resolve[1]}`);
      const expires = report?.room_expires;
      if (!report || typeof report.room_id !== "string"
          || typeof expires !== "number" || !Number.isSafeInteger(expires)
          || expires <= Math.floor(Date.now() / 1000)) {
        return new Response("Not found", {status: 404});
      }
    }

    const response = await super.fetch(request);
    // A successful POST may have created a new report after the first pruning
    // pass. Schedule its room-expiry alarm after the base inbox has scheduled
    // its longer retention alarm.
    if (request.method === "POST" && response.ok) await this.pruneExpiredRouting();
    return response;
  }

  async alarm(): Promise<void> {
    // Let the base inbox delete 30-day records first, then restore the earlier
    // of its next retention alarm and any remaining room-routing expiry.
    await super.alarm();
    await this.pruneExpiredRouting();
  }
}

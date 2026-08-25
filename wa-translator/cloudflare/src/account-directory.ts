import { UserDirectory as WorkerUserDirectory } from "./worker";

const DELIVERY_PATTERN = /^u1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{11})\.(call|chat|tts)$/;
const DELIVERY_MARKER_PREFIX = "delivery:";
const DELIVERY_RETENTION_MS = 48 * 60 * 60 * 1000;
const SESSION_REVOCATION_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_REVOCATION_PREFIX = "session-revoked:";
const SESSION_REVOCATION_MAX_MS = 31 * 24 * 60 * 60 * 1000;
const ALARM_FLOOR_MS = 1_000;

type UserTotals = {call_minutes: number; chat_messages: number; tts_phrases: number};
type UsageRecord = {at: string; kind: string; units: number; room_ref: string};
type DeliveryMarker = {createdAt: number};
type SessionRevocation = {expiresAt: number};
type UserProfile = {
  user_id: string; provider: string; name: string; email: string; created_at: string;
};

const EMPTY_TOTALS: UserTotals = {call_minutes: 0, chat_messages: 0, tts_phrases: 0};
const TOTAL_FIELD = new Map([
  ["call", "call_minutes"], ["chat", "chat_messages"], ["tts", "tts_phrases"],
] as const);

// Keep the existing Durable Object class name/migration while retiring the
// zero-only credits preview, adding retry-safe usage delivery, and giving each
// browser/native session a real server-side logout lifetime. The base object
// remains compatible with rooms and sessions from the previous deployment.
export class UserDirectory extends WorkerUserDirectory {
  private async moveAlarmEarlier(target: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || target < existing) {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + ALARM_FLOOR_MS, target));
    }
  }

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
      await this.moveAlarmEarlier(earliest);
    }
  }

  private async pruneSessionRevocations(): Promise<void> {
    const now = Date.now();
    const markers = await this.ctx.storage.list<SessionRevocation>({prefix: SESSION_REVOCATION_PREFIX});
    const expired = [...markers].filter(([, marker]) =>
      !Number.isSafeInteger(marker.expiresAt)
      || marker.expiresAt * 1000 <= now
      || marker.expiresAt * 1000 > now + SESSION_REVOCATION_MAX_MS
    );
    if (expired.length) await this.ctx.storage.delete(expired.map(([key]) => key));
    for (const [key] of expired) markers.delete(key);

    if (markers.size) {
      const earliest = Math.min(...[...markers.values()].map(marker => marker.expiresAt * 1000));
      await this.moveAlarmEarlier(earliest);
    }
  }

  private async sessionRevocation(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/session-revocations") {
      let data: Record<string, unknown>;
      try {
        const parsed = await request.json<unknown>();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        data = parsed as Record<string, unknown>;
      } catch {
        return new Response("Invalid session revocation", {status: 400});
      }
      const digest = typeof data.digest === "string" ? data.digest : "";
      const expiresAt = data.expires_at;
      const now = Date.now();
      if (Object.keys(data).sort().join(",") !== "digest,expires_at"
          || !SESSION_REVOCATION_PATTERN.test(digest)
          || typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)
          || expiresAt * 1000 <= now || expiresAt * 1000 > now + SESSION_REVOCATION_MAX_MS) {
        return new Response("Invalid session revocation", {status: 400});
      }
      if (!await this.ctx.storage.get("profile")) {
        return new Response("Not found", {status: 404});
      }
      await this.ctx.storage.put(`${SESSION_REVOCATION_PREFIX}${digest}`, {expiresAt});
      await this.pruneSessionRevocations();
      return new Response(null, {status: 204});
    }

    const match = url.pathname.match(/^\/session-revocations\/([A-Za-z0-9_-]{43})$/);
    if (!match || request.method !== "GET") return null;
    const key = `${SESSION_REVOCATION_PREFIX}${match[1]}`;
    const marker = await this.ctx.storage.get<SessionRevocation>(key);
    if (!marker || !Number.isSafeInteger(marker.expiresAt)
        || marker.expiresAt * 1000 <= Date.now()) {
      if (marker) await this.ctx.storage.delete(key);
      await this.pruneSessionRevocations();
      return new Response("Not found", {status: 404});
    }
    return new Response(null, {status: 204});
  }

  // Apple provides the person's name only on the first authorization. Later
  // ID tokens normally contain only the relay email, which the base callback
  // uses as a fallback name. Preserve an already-captured Apple name rather
  // than letting a routine later login silently downgrade the profile to email.
  private async preserveAppleProfileName(request: Request): Promise<Request> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/") return request;
    let data: Record<string, unknown>;
    try {
      const parsed = await request.clone().json<unknown>();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return request;
      data = parsed as Record<string, unknown>;
    } catch {
      return request;
    }
    if (data.provider !== "apple" || typeof data.name !== "string"
        || typeof data.email !== "string" || data.name !== data.email) return request;
    const existing = await this.ctx.storage.get<UserProfile>("profile");
    if (!existing || existing.provider !== "apple" || !existing.name
        || existing.name === existing.email) return request;

    data.name = existing.name;
    const headers = new Headers(request.headers);
    headers.delete("Content-Length");
    headers.set("Content-Type", "application/json");
    return new Request(request, {headers, body: JSON.stringify(data)});
  }

  // Internal-only metadata patch used after the normal Apple OAuth callback has
  // already authenticated the account. It can change the display name only;
  // subject, derived user id, provider and email remain owned by the validated
  // provider identity path.
  private async appleProfileName(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/profile-name") return null;
    let data: Record<string, unknown>;
    try {
      const parsed = await request.json<unknown>();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      data = parsed as Record<string, unknown>;
    } catch {
      return new Response("Invalid profile name", {status: 400});
    }
    const name = typeof data.name === "string" ? data.name : "";
    if (Object.keys(data).join(",") !== "name" || name !== name.trim()
        || name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      return new Response("Invalid profile name", {status: 400});
    }

    const outcome = await this.ctx.storage.transaction(async transaction => {
      const profile = await transaction.get<UserProfile>("profile");
      if (!profile) return "missing" as const;
      if (profile.provider !== "apple") return "provider" as const;
      profile.name = name;
      await transaction.put("profile", profile);
      return "stored" as const;
    });
    if (outcome === "missing") return new Response("Not found", {status: 404});
    if (outcome === "provider") return new Response("Provider mismatch", {status: 409});
    await this.ctx.storage.delete("credits");
    return new Response(null, {status: 204});
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
    await this.pruneSessionRevocations();
    return new Response(null, {status: 204});
  }

  async fetch(request: Request): Promise<Response> {
    const revocation = await this.sessionRevocation(request);
    if (revocation) return revocation;

    const profileName = await this.appleProfileName(request);
    if (profileName) return profileName;

    const idempotent = await this.idempotentUsage(request);
    if (idempotent) return idempotent;

    const url = new URL(request.url);
    const accountRoot = url.pathname === "/";
    const forwarded = await this.preserveAppleProfileName(request);
    const response = await super.fetch(forwarded);

    // Root profile reads/writes and legacy /usage writes are all account
    // activity. An old zero-only balance should disappear on whichever
    // successful operation happens first rather than waiting for /api/me.
    if (response.ok && (request.method === "GET" || request.method === "POST")) {
      await this.ctx.storage.delete("credits");
      await this.pruneDeliveryMarkers();
      await this.pruneSessionRevocations();
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
    await this.pruneSessionRevocations();
  }
}

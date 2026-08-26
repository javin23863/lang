import { UserDirectory as AccountDirectory } from "./account-directory";
import type { Env } from "./worker";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const OWNED_ROOMS_KEY = "owned-rooms:v1";
const DELETION_FENCE_KEY = "account-deleting:v1";
const OWNED_ROOM_LIMIT = 128;
const ROOM_MAX_FUTURE_MS = 24 * 60 * 60 * 1000 + 60_000;
const DELETION_FENCE_TTL_MS = 2 * 60 * 1000;
const CLOSE_BATCH_SIZE = 16;

type OwnedRoom = {id: string; expiresAt: number};
type DeletionFence = {startedAt: number};

type RegistryClaim =
  | {status: "claimed"; rooms: OwnedRoom[]}
  | {status: "busy" | "missing" | "corrupt"};

function validRoomRecord(value: unknown, now: number, requireLive = false): value is OwnedRoom {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "expiresAt,id") return false;
  if (typeof record.id !== "string" || !ROOM_ID_PATTERN.test(record.id)) return false;
  if (typeof record.expiresAt !== "number" || !Number.isSafeInteger(record.expiresAt)) return false;
  const expiryMs = record.expiresAt * 1000;
  if (expiryMs > now + ROOM_MAX_FUTURE_MS) return false;
  return !requireLive || expiryMs > now;
}

function liveRegistry(value: unknown, now: number): OwnedRoom[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > OWNED_ROOM_LIMIT) return null;
  const seen = new Set<string>();
  const rooms: OwnedRoom[] = [];
  for (const item of value) {
    if (!validRoomRecord(item, now)) return null;
    if (item.expiresAt * 1000 <= now || seen.has(item.id)) continue;
    seen.add(item.id);
    rooms.push({id: item.id, expiresAt: item.expiresAt});
  }
  return rooms;
}

function activeFence(value: unknown, now: number): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const startedAt = (value as DeletionFence).startedAt;
  return Number.isSafeInteger(startedAt)
    && startedAt <= now
    && startedAt + DELETION_FENCE_TTL_MS > now;
}

export class UserDirectory extends AccountDirectory {
  private async moveAlarmEarlier(target: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || target < existing) {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, target));
    }
  }

  private async registerOwnedRoom(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/owned-rooms") return null;

    let data: Record<string, unknown>;
    try {
      const parsed = await request.json<unknown>();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      data = parsed as Record<string, unknown>;
    } catch {
      return new Response("Invalid owned room", {status: 400});
    }

    const now = Date.now();
    const room = {id: data.room_id, expiresAt: data.expires_at};
    if (Object.keys(data).sort().join(",") !== "expires_at,room_id"
        || !validRoomRecord(room, now, true)) {
      return new Response("Invalid owned room", {status: 400});
    }

    const outcome = await this.ctx.storage.transaction(async transaction => {
      if (!await transaction.get("profile")) return "missing" as const;

      const fence = await transaction.get<DeletionFence>(DELETION_FENCE_KEY);
      if (activeFence(fence, now)) return "deleting" as const;
      if (fence !== undefined) await transaction.delete(DELETION_FENCE_KEY);

      const rooms = liveRegistry(await transaction.get(OWNED_ROOMS_KEY), now);
      if (!rooms) return "corrupt" as const;
      const existing = rooms.findIndex(item => item.id === room.id);
      if (existing >= 0) rooms[existing] = room as OwnedRoom;
      else {
        if (rooms.length >= OWNED_ROOM_LIMIT) return "full" as const;
        rooms.push(room as OwnedRoom);
      }
      await transaction.put(OWNED_ROOMS_KEY, rooms);
      return "stored" as const;
    });

    if (outcome === "missing") return new Response("Not found", {status: 404});
    if (outcome === "deleting") return new Response("Account deletion in progress", {status: 409});
    if (outcome === "full") return new Response("Too many active rooms", {status: 429});
    if (outcome === "corrupt") return new Response("Owned-room registry unavailable", {status: 503});
    await this.moveAlarmEarlier((room as OwnedRoom).expiresAt * 1000);
    return new Response(null, {status: 204});
  }

  private async claimDeletion(): Promise<RegistryClaim> {
    const now = Date.now();
    return this.ctx.storage.transaction(async transaction => {
      if (!await transaction.get("profile")) return {status: "missing"} as const;
      const fence = await transaction.get<DeletionFence>(DELETION_FENCE_KEY);
      if (activeFence(fence, now)) return {status: "busy"} as const;
      if (fence !== undefined) await transaction.delete(DELETION_FENCE_KEY);

      const rooms = liveRegistry(await transaction.get(OWNED_ROOMS_KEY), now);
      if (!rooms) return {status: "corrupt"} as const;
      if (rooms.length) await transaction.put(OWNED_ROOMS_KEY, rooms);
      else await transaction.delete(OWNED_ROOMS_KEY);
      await transaction.put(DELETION_FENCE_KEY, {startedAt: now});
      return {status: "claimed", rooms} as const;
    });
  }

  private async closeOwnedRooms(rooms: OwnedRoom[]): Promise<OwnedRoom[]> {
    const failed: OwnedRoom[] = [];
    for (let offset = 0; offset < rooms.length; offset += CLOSE_BATCH_SIZE) {
      const batch = rooms.slice(offset, offset + CLOSE_BATCH_SIZE);
      const outcomes = await Promise.all(batch.map(async room => {
        try {
          const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(room.id)).fetch(
            new Request("https://room.internal/close", {
              method: "POST",
              headers: {"X-Room-Expires": String(room.expiresAt)},
            })
          );
          const status = response.status;
          await response.body?.cancel().catch(() => {});
          return response.ok || status === 410;
        } catch {
          return false;
        }
      }));
      for (let index = 0; index < batch.length; index++) {
        if (!outcomes[index]) failed.push(batch[index]);
      }
    }
    return failed;
  }

  private async accountDeletionWithRooms(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (request.method !== "DELETE" || url.pathname !== "/") return null;

    const claim = await this.claimDeletion();
    if (claim.status === "missing") return super.fetch(request);
    if (claim.status === "busy") {
      return new Response("Account deletion already in progress", {status: 409});
    }
    if (claim.status === "corrupt") {
      return new Response("Account room registry unavailable", {status: 503});
    }

    const failed = await this.closeOwnedRooms(claim.rooms);
    if (failed.length) {
      await this.ctx.storage.transaction(async transaction => {
        await transaction.put(OWNED_ROOMS_KEY, failed);
        await transaction.delete(DELETION_FENCE_KEY);
      });
      return new Response("Unable to close all account rooms", {status: 503});
    }

    const response = await super.fetch(request);
    if (!response.ok) await this.ctx.storage.delete(DELETION_FENCE_KEY);
    return response;
  }

  async fetch(request: Request): Promise<Response> {
    const registered = await this.registerOwnedRoom(request);
    if (registered) return registered;
    const deleted = await this.accountDeletionWithRooms(request);
    if (deleted) return deleted;
    return super.fetch(request);
  }

  async alarm(): Promise<void> {
    await super.alarm();
    const now = Date.now();
    const value = await this.ctx.storage.get(OWNED_ROOMS_KEY);
    const rooms = liveRegistry(value, now);
    if (rooms) {
      if (rooms.length) {
        await this.ctx.storage.put(OWNED_ROOMS_KEY, rooms);
        await this.moveAlarmEarlier(Math.min(...rooms.map(room => room.expiresAt * 1000)));
      } else if (value !== undefined) {
        await this.ctx.storage.delete(OWNED_ROOMS_KEY);
      }
    }
    const fence = await this.ctx.storage.get<DeletionFence>(DELETION_FENCE_KEY);
    if (fence !== undefined && !activeFence(fence, now)) {
      await this.ctx.storage.delete(DELETION_FENCE_KEY);
    }
  }
}

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";
type CreatedRoom = {path: string};

describe("room activation event seam", () => {
  it("ships same-origin, content-free activation instrumentation on a real private room surface", async () => {
    const created = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {Origin: ORIGIN, Cookie: await hostSessionCookie("ProductEventHost123456")},
    });
    expect(created.status).toBe(201);
    const {path} = await created.json<CreatedRoom>();

    const room = await exports.default.fetch(`${ORIGIN}${path}`);
    expect(room.status).toBe(200);
    const html = await room.text();
    const runtime = html.indexOf('<script src="/app-runtime.js"></script>');
    const events = html.indexOf('<script src="/product-events.js"></script>');
    const roomEvents = html.indexOf('<script src="/room-product-events.js"></script>');
    const roomRuntime = html.indexOf('<script src="/room.js"></script>');
    expect(runtime).toBeGreaterThanOrEqual(0);
    expect(events).toBeGreaterThan(runtime);
    expect(roomEvents).toBeGreaterThan(events);
    expect(roomRuntime).toBeGreaterThan(roomEvents);

    const eventResponse = await exports.default.fetch(`${ORIGIN}/product-events.js`);
    expect(eventResponse.status).toBe(200);
    const eventSource = await eventResponse.text();
    for (const marker of [
      '"room.join.intent": new Set(["mode"])',
      '"room.pair.ready": new Set(["mode"])',
      '"translation.first.result": new Set(["mode"])',
      '"network.state": new Set(["state"])',
      '? "room" : "other"',
    ]) expect(eventSource).toContain(marker);

    const adapterResponse = await exports.default.fetch(`${ORIGIN}/room-product-events.js`);
    expect(adapterResponse.status).toBe(200);
    const adapter = await adapterResponse.text();
    for (const marker of [
      'emit("room.join.intent", {mode})',
      'emit("room.pair.ready", {mode})',
      'emit("translation.first.result", {mode})',
      'emit("network.state", {state})',
      'document.body.dataset.network = state',
      'state === "offline" ? "status.reconnecting" : "status.rejoining"',
      'window.addEventListener("offline", () => presentNetworkState("offline"))',
      'window.addEventListener("online", () => presentNetworkState("online"))',
      'new MutationObserver(check).observe(count',
      'captions.querySelectorAll(".msg .sub")',
    ]) expect(adapter).toContain(marker);

    for (const forbidden of [
      "fetch(", "sendBeacon", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage",
      "document.cookie", "Authorization", "roomId", "host_control", "shareLink", "transcript",
    ]) expect(adapter).not.toContain(forbidden);
  });
});

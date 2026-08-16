import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";

type Created = { path: string; hostControl: string };

async function createRoom(): Promise<Created> {
  const response = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: await hostSessionCookie() }
  });
  expect(response.status).toBe(201);
  const created = await response.json<{ path: string; host_control: string }>();
  return { path: created.path, hostControl: created.host_control };
}

async function warmCalls(): Promise<number> {
  const response = await env.MODAL_TEST!.fetch("https://modal.test/counters", {
    headers: { Authorization: "Bearer test-only-modal-secret" }
  });
  return (await response.json<{ warm: number }>()).warm;
}

// The prewarm rides ctx.waitUntil, so it lands after the response the caller
// already has. Poll rather than assert on the next line.
async function warmCallsAtLeast(target: number): Promise<number> {
  for (let attempt = 0; attempt < 50 && await warmCalls() < target; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return warmCalls();
}

describe("compute prewarm", () => {
  it("warms the GPU when a room is created and when the invite is opened", async () => {
    const before = await warmCalls();
    const { path } = await createRoom();
    expect(await warmCallsAtLeast(before + 1)).toBe(before + 1);

    const page = await exports.default.fetch(`${ORIGIN}${path}`);
    expect(page.status).toBe(200);
    expect(await warmCallsAtLeast(before + 2)).toBe(before + 2);
  });

  it("does not warm on the host dashboard's status poll", async () => {
    const { hostControl } = await createRoom();
    const before = await warmCallsAtLeast(1);

    for (let poll = 0; poll < 3; poll++) {
      const status = await exports.default.fetch(`${ORIGIN}/api/room-control`, {
        headers: { Origin: ORIGIN, Authorization: `Bearer ${hostControl}` }
      });
      expect(status.status).toBe(200);
    }
    // Long enough that a queued waitUntil would have shown up by now.
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await warmCalls()).toBe(before);
  });

  it("does not warm on a room page that no longer resolves", async () => {
    const { path, hostControl } = await createRoom();
    const closed = await exports.default.fetch(`${ORIGIN}/api/room-control/close`, {
      method: "POST",
      headers: { Origin: ORIGIN, Authorization: `Bearer ${hostControl}` }
    });
    expect(closed.status).toBe(200);
    const before = await warmCallsAtLeast(1);

    const page = await exports.default.fetch(`${ORIGIN}${path}`);
    expect(page.status).toBe(404);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await warmCalls()).toBe(before);
  });
});

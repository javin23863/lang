import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostSessionCookie } from "./session";

const ORIGIN = "https://room.test";

describe("participant terminal-close client", () => {
  it("recognizes host room closure before its socket close can schedule a reconnect", async () => {
    const created = await exports.default.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST", headers: { Origin: ORIGIN, Cookie: await hostSessionCookie() }
    });
    const { path } = await created.json<{ path: string }>();
    const page = await exports.default.fetch(`${ORIGIN}${path}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('m.type === \'room_closed\'');
    expect(html).toContain('event.code === 4001');
    expect(html).toContain('terminalRoom = true');
    // The closed-room line is a dictionary key now, not a sentence: it has to
    // reach the participant in the language they picked.
    expect(html).toContain("setStatus('status.roomClosed', null, true)");
    expect(html).toContain("showVideoNote('note.closedByHost')");
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser connect generation deployment", () => {
  it("serves generation ownership for preflight, TURN JSON bodies, and BFCache restore ordering", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/qr.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain('const ROOM_CONTROL_JSON_PATHS = new Set(["/api/capabilities", "/api/turn"])');
    expect(source).toContain("let browserTurnRefreshGeneration = -1");
    expect(source).toContain("function connectLifecycleAbortError()");
    expect(source).toContain("error.linguaConnectLifecycle = true");
    expect(source).toContain("function browserRoomGenerationActive(generation)");
    expect(source).toContain("preflightRoom = async function lifecycleAwarePreflightRoom");
    expect(source).toContain("refreshIceServers = function lifecycleAwareRefreshIceServers");
    expect(source).toContain("previousTask && previousGeneration !== generation");
    expect(source).toContain("await previousTask");
    expect(source).toContain("connect = async function lifecycleAwareConnect");
    expect(source).toContain("const requestGeneration = browserRoomGeneration");
    expect(source).toContain("new Proxy(response");
    expect(source).toContain("const value = await readJson(...args)");
    expect(source).toContain("browserRoomGenerationActive(requestGeneration)");
    expect(source).toContain('window.addEventListener("pagehide", () => {');
    expect(source).toContain('}, {capture: true});\n    window.addEventListener("pageshow", event => {');
    expect(source).toContain("queueMicrotask(retryCapabilities)");
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://room.test";

describe("browser capability bootstrap deployment", () => {
  it("serves the synchronous transport-independent initial capability deadline", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/app-runtime.js`);
    expect(response.status).toBe(200);

    const source = await response.text();
    expect(source).toContain("const BROWSER_BOOTSTRAP_FETCH_TIMEOUT_MS = 12000");
    expect(source).toContain("function installBrowserCapabilityBootstrapDeadline()");
    expect(source).toContain("let bootstrapCapabilitiesPending = true");
    expect(source).toContain('url.origin !== location.origin');
    expect(source).toContain('url.pathname !== "/api/capabilities"');
    expect(source).toContain("bootstrapCapabilitiesPending = false");
    expect(source).toContain("const controller = new AbortController()");
    expect(source).toContain("callerSignal?.addEventListener(\"abort\", abortFromCaller, {once: true})");
    expect(source).toContain("setTimeout(() => controller.abort(), BROWSER_BOOTSTRAP_FETCH_TIMEOUT_MS)");
    expect(source).toContain("nativeFetch(input, {...init, signal: controller.signal})");
    expect(source).toContain("clearTimeout(timer)");
    expect(source).toContain("callerSignal?.removeEventListener(\"abort\", abortFromCaller)");

    expect(source.indexOf("installBrowserCapabilityBootstrapDeadline();")).toBeLessThan(
      source.indexOf("installBrowserRoomNetworkRecovery();"),
    );
    expect(source.indexOf("installBrowserCapabilityBootstrapDeadline();")).toBeLessThan(
      source.indexOf('typeof NativeWebSocket !== "function" || typeof NativePeerConnection !== "function"'),
    );
  });
});

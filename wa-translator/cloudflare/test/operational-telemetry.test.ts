import { describe, expect, it } from "vitest";
import {
  failureCodeForStatus,
  operationalExceptionRecord,
  operationalFailureRecord,
  routeClassForRequest,
  withFailureRequestId,
} from "../src/operational-telemetry";

describe("privacy-safe operational telemetry", () => {
  it("classifies capability-bearing room requests without recording their URL or token", () => {
    const roomBearer = "ABCDEFGHIJKLMNOPQRSTUVWX.1760000000.abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
    const querySecret = "must-never-enter-logs";
    const request = new Request(`https://room.example/room/${roomBearer}?token=${querySecret}`, {
      method: "POST",
      headers: {Authorization: `Bearer ${roomBearer}`},
    });

    expect(routeClassForRequest(request)).toBe("room");
    const record = operationalFailureRecord(request, 503, "request-test-1", 12.6);
    expect(record).toEqual({
      event: "edge.request.failure",
      request_id: "request-test-1",
      route_class: "room",
      method: "POST",
      status: 503,
      result: "server_error",
      result_code: "http.unavailable",
      duration_ms: 13,
    });

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(roomBearer);
    expect(serialized).not.toContain(querySecret);
    expect(serialized).not.toContain("room.example");
    expect(serialized).not.toContain("Authorization");
  });

  it("uses stable coarse result codes suitable for dashboards without response bodies", () => {
    expect(failureCodeForStatus(400)).toBe("http.bad_request");
    expect(failureCodeForStatus(401)).toBe("http.unauthorized");
    expect(failureCodeForStatus(403)).toBe("http.forbidden");
    expect(failureCodeForStatus(404)).toBe("http.not_found");
    expect(failureCodeForStatus(408)).toBe("http.timeout");
    expect(failureCodeForStatus(409)).toBe("http.conflict");
    expect(failureCodeForStatus(429)).toBe("http.rate_limited");
    expect(failureCodeForStatus(502)).toBe("http.bad_gateway");
    expect(failureCodeForStatus(503)).toBe("http.unavailable");
    expect(failureCodeForStatus(504)).toBe("http.gateway_timeout");
    expect(failureCodeForStatus(418)).toBe("http.client_error");
    expect(failureCodeForStatus(599)).toBe("http.server_error");
  });

  it("records exception type but never exception message content", () => {
    const secret = "private-message-content";
    const request = new Request("https://room.example/api/v1/mobile/bootstrap");
    const record = operationalExceptionRecord(
      request, new TypeError(secret), "request-test-2", 7.4
    );

    expect(record).toMatchObject({
      event: "edge.request.exception",
      request_id: "request-test-2",
      route_class: "bootstrap",
      method: "GET",
      error_type: "TypeError",
      duration_ms: 7,
    });
    expect(JSON.stringify(record)).not.toContain(secret);
  });

  it("adds correlation only to HTTP failures and leaves successful responses untouched", async () => {
    const success = new Response("ok", {status: 200});
    expect(withFailureRequestId(success, "request-ok")).toBe(success);

    const failure = withFailureRequestId(new Response("unavailable", {
      status: 503,
      headers: {"Cache-Control": "no-store"},
    }), "request-failure");
    expect(failure.status).toBe(503);
    expect(failure.headers.get("X-Lingua-Request-ID")).toBe("request-failure");
    expect(failure.headers.get("Cache-Control")).toBe("no-store");
    expect(await failure.text()).toBe("unavailable");
  });

  it("normalizes uncommon methods and rate-limit results", () => {
    const request = new Request("https://room.example/api/v1/reports", {method: "PROPFIND"});
    expect(operationalFailureRecord(request, 429, "request-test-3", -1)).toMatchObject({
      route_class: "report",
      method: "OTHER",
      result: "rate_limited",
      result_code: "http.rate_limited",
      duration_ms: 0,
    });
  });
});

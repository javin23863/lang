const SAFE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export type RouteClass =
  | "health"
  | "bootstrap"
  | "auth"
  | "account"
  | "room"
  | "report"
  | "translation"
  | "asset"
  | "api"
  | "other";

type FailureResult = "client_error" | "rate_limited" | "server_error";
type SuccessResult = "success" | "redirect" | "upgrade";
export type FailureCode =
  | "http.bad_request"
  | "http.unauthorized"
  | "http.forbidden"
  | "http.not_found"
  | "http.conflict"
  | "http.timeout"
  | "http.rate_limited"
  | "http.client_error"
  | "http.bad_gateway"
  | "http.unavailable"
  | "http.gateway_timeout"
  | "http.server_error";

export interface OperationalSuccessRecord {
  event: "edge.request.success";
  request_id: string;
  route_class: RouteClass;
  method: string;
  status: number;
  result: SuccessResult;
  duration_ms: number;
}

export interface OperationalFailureRecord {
  event: "edge.request.failure";
  request_id: string;
  route_class: RouteClass;
  method: string;
  status: number;
  result: FailureResult;
  result_code: FailureCode;
  duration_ms: number;
}

export interface OperationalExceptionRecord {
  event: "edge.request.exception";
  request_id: string;
  route_class: RouteClass;
  method: string;
  error_type: string;
  duration_ms: number;
}

function methodClass(method: string): string {
  const normalized = String(method || "").toUpperCase();
  return SAFE_METHODS.has(normalized) ? normalized : "OTHER";
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(86_400_000, Math.round(value));
}

function safeErrorType(error: unknown): string {
  const value = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : "Error";
}

export function failureCodeForStatus(status: number): FailureCode {
  switch (status) {
    case 400: return "http.bad_request";
    case 401: return "http.unauthorized";
    case 403: return "http.forbidden";
    case 404: return "http.not_found";
    case 408: return "http.timeout";
    case 409: return "http.conflict";
    case 429: return "http.rate_limited";
    case 502: return "http.bad_gateway";
    case 503: return "http.unavailable";
    case 504: return "http.gateway_timeout";
    default: return status >= 500 ? "http.server_error" : "http.client_error";
  }
}

export function routeClassForRequest(request: Request): RouteClass {
  let path = "/";
  try { path = new URL(request.url).pathname; } catch { return "other"; }

  if (path === "/health") return "health";
  if (path === "/api/v1/mobile/bootstrap") return "bootstrap";
  if (path.startsWith("/auth/") || path.startsWith("/api/v1/auth/")) return "auth";
  if (path === "/api/me" || path === "/api/v1/me" || path.startsWith("/api/account")) return "account";
  if (path === "/api/reports" || path === "/api/v1/reports") return "report";
  if (path === "/tts" || path.startsWith("/api/translate") || path.startsWith("/api/v1/translate")) {
    return "translation";
  }
  if (path.startsWith("/room/") || path === "/room.html"
      || path === "/api/room" || path === "/api/rooms"
      || path === "/api/v1/room" || path === "/api/v1/rooms") return "room";
  if (path.startsWith("/static/") || /\.(?:css|js|json|svg|png|webmanifest|html)$/.test(path)) return "asset";
  if (path.startsWith("/api/")) return "api";
  return "other";
}

export function operationalSuccessRecord(
  request: Request, status: number, requestId: string, durationMs: number
): OperationalSuccessRecord {
  return {
    event: "edge.request.success",
    request_id: requestId,
    route_class: routeClassForRequest(request),
    method: methodClass(request.method),
    status,
    result: status === 101 ? "upgrade" : status >= 300 ? "redirect" : "success",
    duration_ms: boundedDuration(durationMs),
  };
}

export function operationalFailureRecord(
  request: Request, status: number, requestId: string, durationMs: number
): OperationalFailureRecord {
  return {
    event: "edge.request.failure",
    request_id: requestId,
    route_class: routeClassForRequest(request),
    method: methodClass(request.method),
    status,
    result: status === 429 ? "rate_limited" : status >= 500 ? "server_error" : "client_error",
    result_code: failureCodeForStatus(status),
    duration_ms: boundedDuration(durationMs),
  };
}

export function operationalExceptionRecord(
  request: Request, error: unknown, requestId: string, durationMs: number
): OperationalExceptionRecord {
  return {
    event: "edge.request.exception",
    request_id: requestId,
    route_class: routeClassForRequest(request),
    method: methodClass(request.method),
    error_type: safeErrorType(error),
    duration_ms: boundedDuration(durationMs),
  };
}

export function logOperationalSuccess(record: OperationalSuccessRecord): void {
  // Assets and the plain health probe already have native Workers telemetry;
  // custom success events are reserved for product/control-plane SLOs so logs
  // stay useful without copying capability-bearing URLs or flooding on assets.
  if (record.route_class === "asset" || record.route_class === "health" || record.route_class === "other") return;
  console.log(JSON.stringify(record));
}

export function logOperationalFailure(record: OperationalFailureRecord): void {
  // Deliberately log the fixed record only. Never attach request URL, headers,
  // account identity, room bearer, message/caption text, or exception message.
  if (record.status >= 500) console.error(JSON.stringify(record));
  else console.warn(JSON.stringify(record));
}

export function logOperationalException(record: OperationalExceptionRecord): void {
  console.error(JSON.stringify(record));
}

export function withFailureRequestId(response: Response, requestId: string): Response {
  if (response.status < 400) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Lingua-Request-ID", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

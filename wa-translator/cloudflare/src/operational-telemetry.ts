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

export type OperationClass =
  | "health"
  | "mobile.bootstrap"
  | "auth.start"
  | "auth.handoff"
  | "auth.logout"
  | "auth.other"
  | "account.snapshot"
  | "account.delete"
  | "room.page"
  | "room.create"
  | "room.preflight"
  | "room.status"
  | "room.close"
  | "room.capabilities"
  | "room.turn"
  | "report.submit"
  | "translation.tts"
  | "translation.compute"
  | "asset"
  | "api.other"
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
  operation: OperationClass;
  method: string;
  status: number;
  result: SuccessResult;
  duration_ms: number;
}

export interface OperationalFailureRecord {
  event: "edge.request.failure";
  request_id: string;
  route_class: RouteClass;
  operation: OperationClass;
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
  operation: OperationClass;
  method: string;
  error_type: string;
  duration_ms: number;
}

type RequestClassification = {routeClass: RouteClass; operation: OperationClass};

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

function classifyPath(path: string): RequestClassification {
  if (path === "/health") return {routeClass: "health", operation: "health"};
  if (path === "/api/v1/mobile/bootstrap") {
    return {routeClass: "bootstrap", operation: "mobile.bootstrap"};
  }

  if (path === "/api/v1/auth/handoff") return {routeClass: "auth", operation: "auth.handoff"};
  if (path === "/auth/logout" || path === "/api/v1/auth/logout") {
    return {routeClass: "auth", operation: "auth.logout"};
  }
  if (/^\/auth\/(?:native\/)?(?:google|apple|facebook)\/start$/.test(path)) {
    return {routeClass: "auth", operation: "auth.start"};
  }
  if (path.startsWith("/auth/") || path.startsWith("/api/v1/auth/")) {
    return {routeClass: "auth", operation: "auth.other"};
  }

  if (path === "/api/me" || path === "/api/v1/me") {
    return {routeClass: "account", operation: "account.snapshot"};
  }
  if (path === "/api/account/delete" || path === "/api/v1/account/delete") {
    return {routeClass: "account", operation: "account.delete"};
  }
  if (path.startsWith("/api/account/") || path.startsWith("/api/v1/account/")) {
    return {routeClass: "account", operation: "api.other"};
  }

  if (path === "/api/reports" || path === "/api/v1/reports") {
    return {routeClass: "report", operation: "report.submit"};
  }
  if (path === "/tts" || path === "/api/v1/tts") {
    return {routeClass: "translation", operation: "translation.tts"};
  }
  if (path.startsWith("/api/translate") || path.startsWith("/api/v1/translate")) {
    return {routeClass: "translation", operation: "translation.compute"};
  }

  if (path.startsWith("/room/") || path === "/room.html") {
    return {routeClass: "room", operation: "room.page"};
  }
  if (path === "/api/rooms" || path === "/api/v1/rooms") {
    return {routeClass: "room", operation: "room.create"};
  }
  if (path === "/api/room" || path === "/api/v1/room") {
    return {routeClass: "room", operation: "room.preflight"};
  }
  if (path === "/api/room-control" || path === "/api/v1/room-control") {
    return {routeClass: "room", operation: "room.status"};
  }
  if (path === "/api/room-control/close" || path === "/api/v1/room-control/close") {
    return {routeClass: "room", operation: "room.close"};
  }
  if (path === "/api/capabilities" || path === "/api/v1/capabilities") {
    return {routeClass: "room", operation: "room.capabilities"};
  }
  if (path === "/api/turn" || path === "/api/v1/turn") {
    return {routeClass: "room", operation: "room.turn"};
  }

  if (path.startsWith("/static/") || /\.(?:css|js|json|svg|png|webmanifest|html)$/.test(path)) {
    return {routeClass: "asset", operation: "asset"};
  }
  if (path.startsWith("/api/")) return {routeClass: "api", operation: "api.other"};
  return {routeClass: "other", operation: "other"};
}

function classifyRequest(request: Request): RequestClassification {
  try { return classifyPath(new URL(request.url).pathname); }
  catch { return {routeClass: "other", operation: "other"}; }
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
  return classifyRequest(request).routeClass;
}

export function operationForRequest(request: Request): OperationClass {
  return classifyRequest(request).operation;
}

export function operationalSuccessRecord(
  request: Request, status: number, requestId: string, durationMs: number
): OperationalSuccessRecord {
  const classification = classifyRequest(request);
  return {
    event: "edge.request.success",
    request_id: requestId,
    route_class: classification.routeClass,
    operation: classification.operation,
    method: methodClass(request.method),
    status,
    result: status === 101 ? "upgrade" : status >= 300 ? "redirect" : "success",
    duration_ms: boundedDuration(durationMs),
  };
}

export function operationalFailureRecord(
  request: Request, status: number, requestId: string, durationMs: number
): OperationalFailureRecord {
  const classification = classifyRequest(request);
  return {
    event: "edge.request.failure",
    request_id: requestId,
    route_class: classification.routeClass,
    operation: classification.operation,
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
  const classification = classifyRequest(request);
  return {
    event: "edge.request.exception",
    request_id: requestId,
    route_class: classification.routeClass,
    operation: classification.operation,
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

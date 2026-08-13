import { DurableObject } from "cloudflare:workers";
import roomHtml from "../../windows/static/room.html";

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<Room>;
  PUBLIC_ORIGIN?: string;
  ROOM_SIGNING_KEY: string;
  TURN_TTL_SECONDS: string;
  TURN_KEY_ID: string;
  TURN_API_TOKEN: string;
  TURN_TEST?: Fetcher;
  MODAL_SHARED_SECRET: string;
  MODAL_WS_URL: string;
  MODAL_TTS_URL: string;
  MODAL_TEST?: Fetcher;
}

const ROOM_ID_BYTES = 18;
const ROOM_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONTROL_MESSAGE_BYTES = 8192;
const MAX_PCM_FRAME_BYTES = 32000;
const MAX_COMPUTE_MESSAGE_BYTES = 8192;
const MAX_CAPTION_CHARS = 300;
const COMPUTE_BACKOFF_MAX_MS = 8000;
const MAX_TTS_BODY_BYTES = 2048;
const MAX_TTS_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TTS_CHARS = 300;
const TURN_TTL_MAX_SECONDS = 48 * 60 * 60;
const MAX_PARTICIPANTS = 4;
const MAX_PENDING_SOCKETS = 8;
const PRESENCE_HEARTBEAT_MS = 10_000;
// Hidden mobile browsers may coalesce timers to one wake per minute. Keep the
// heartbeat cheap at 10s, but leave enough margin that the foreground peer's
// heartbeat cannot evict a still-open background peer before its next wake.
const PRESENCE_LEASE_MS = 90_000;
const PCM_RATE_BYTES_PER_SECOND = 40_000;
const PCM_BURST_BYTES = 64_000;
const TTS_WINDOW_MS = 60_000;
const TTS_REQUESTS_PER_WINDOW = 12;
const LANGUAGES = ["en", "es"] as const;
const VOICE_STYLES = ["female", "male"] as const;

type Language = typeof LANGUAGES[number];
type VoiceStyle = typeof VOICE_STYLES[number];
type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type ParticipantAttachment = {
  kind: "browser";
  id: string;
  joined: boolean;
  lang: Language;
  name: string;
  voiceStyle: VoiceStyle;
  lastSeenAt: number;
  ttsWindowStart: number;
  ttsCount: number;
};

type ComputeState = {
  socket: WebSocket | null;
  connecting: Promise<WebSocket | null> | null;
  failures: number;
  nextAttempt: number;
  generation: number;
  abort: AbortController | null;
};

type PcmBudget = { tokens: number; updatedAt: number };

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function signingKey(secret: string, usage: ("sign" | "verify")[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  );
}

function signingSecretIsValid(secret: string): boolean {
  return new TextEncoder().encode(secret || "").byteLength >= 32;
}

async function signRoom(roomId: string, expiresAt: number, secret: string): Promise<string> {
  const payload = `${roomId}.${expiresAt}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret, ["sign"]),
    new TextEncoder().encode(payload)
  );
  return `${payload}.${base64url(signature)}`;
}

type VerifiedRoom = { id: string; expiresAt: number };

async function verifyRoom(token: string, secret: string): Promise<VerifiedRoom | null> {
  if (!signingSecretIsValid(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expiresRaw, signature] = parts;
  if (!ROOM_ID_PATTERN.test(id) || !/^\d{10}$/.test(expiresRaw)
      || !SIGNATURE_PATTERN.test(signature)) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret, ["verify"]),
    fromBase64url(signature).buffer as ArrayBuffer,
    new TextEncoder().encode(`${id}.${expiresRaw}`)
  );
  return valid ? { id, expiresAt } : null;
}

function expectedOrigin(request: Request, env: Env): string {
  return env.PUBLIC_ORIGIN || new URL(request.url).origin;
}

function sameOrigin(request: Request, env: Env): boolean {
  return request.headers.get("Origin") === expectedOrigin(request, env);
}

function sameOriginBrowserGet(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === expectedOrigin(request, env);
  return request.method === "GET"
    && request.headers.get("Sec-Fetch-Site") === "same-origin"
    && ["cors", "same-origin"].includes(request.headers.get("Sec-Fetch-Mode") || "");
}

function privateHeaders(source?: Headers): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Permissions-Policy", "camera=(self), microphone=(self)");
  return headers;
}

function deniedRoom(): Response {
  return new Response("This private room does not exist or has expired.", {
    status: 404,
    headers: privateHeaders()
  });
}

async function createRoomResponse(request: Request, env: Env, redirect: boolean): Promise<Response> {
  if (!sameOrigin(request, env)) return new Response("Forbidden", { status: 403 });
  if (!signingSecretIsValid(env.ROOM_SIGNING_KEY)) {
    return new Response("Room service is unavailable", { status: 503 });
  }
  const roomBytes = crypto.getRandomValues(new Uint8Array(ROOM_ID_BYTES));
  const expiresAt = Math.floor(Date.now() / 1000) + ROOM_TOKEN_TTL_SECONDS;
  const token = await signRoom(base64url(roomBytes), expiresAt, env.ROOM_SIGNING_KEY);
  const path = `/room/${token}`;
  if (redirect) return Response.redirect(new URL(path, request.url).toString(), 303);
  return Response.json({ path }, { status: 201, headers: privateHeaders() });
}

async function roomPage(request: Request, env: Env, token: string): Promise<Response> {
  if (!await verifyRoom(token, env.ROOM_SIGNING_KEY)) return deniedRoom();
  const headers = privateHeaders();
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(roomHtml, { headers });
}

async function authorizedRoom(
  request: Request, env: Env, allowBrowserGet = false
): Promise<VerifiedRoom | null> {
  if (!(allowBrowserGet ? sameOriginBrowserGet(request, env) : sameOrigin(request, env))) {
    return null;
  }
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token && !token.includes(" ") ? verifyRoom(token, env.ROOM_SIGNING_KEY) : null;
}

async function roomPreflight(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  if (!sameOriginBrowserGet(request, env)) return new Response("Forbidden", { status: 403 });
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length) : "";
  if (!token || token.includes(" ") || !await verifyRoom(token, env.ROOM_SIGNING_KEY)) {
    return new Response("Room expired or unavailable", {
      status: 401, headers: privateHeaders()
    });
  }
  return new Response(null, { status: 204, headers: privateHeaders() });
}

function httpsEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function contentLengthTooLarge(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get("Content-Length");
  if (!raw) return false;
  const value = Number(raw);
  return !Number.isSafeInteger(value) || value < 0 || value > maxBytes;
}

function validIceServers(value: unknown): IceServer[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return null;
  const output: IceServer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const rawUrls = typeof record.urls === "string" ? [record.urls] : record.urls;
    if (!Array.isArray(rawUrls) || rawUrls.length === 0 || rawUrls.length > 12
        || rawUrls.some(url => typeof url !== "string"
          || !/^(stun|turn|turns):/.test(url))) return null;
    // Cloudflare documents port 53 as browser-blocked. Trickle ICE tolerates
    // it, but omitting it avoids a needless timeout and keeps the config small.
    const urls = rawUrls.filter(url => !/:53(?:\?|$)/.test(url as string)) as string[];
    if (urls.length === 0) continue;
    const server: IceServer = { urls };
    if (typeof record.username === "string" && typeof record.credential === "string") {
      server.username = record.username;
      server.credential = record.credential;
    }
    output.push(server);
  }
  return output.length ? output : null;
}

async function turnCredentials(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  if (!await authorizedRoom(request, env, true)) return new Response("Forbidden", { status: 403 });
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
    return new Response("TURN is unavailable", { status: 503 });
  }
  const configured = Number(env.TURN_TTL_SECONDS || "3600");
  const ttl = Math.max(60, Math.min(TURN_TTL_MAX_SECONDS,
    Number.isSafeInteger(configured) ? configured : 3600));
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}`
    + "/credentials/generate-ice-servers";
  const upstreamRequest = new Request(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURN_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ttl })
  });
  const upstream = env.TURN_TEST
    ? await env.TURN_TEST.fetch(upstreamRequest)
    : await fetch(upstreamRequest);
  if (upstream.status !== 201) return new Response("TURN is unavailable", { status: 503 });
  let data: Record<string, unknown>;
  try { data = await upstream.json<Record<string, unknown>>(); }
  catch { return new Response("TURN is unavailable", { status: 503 }); }
  const iceServers = validIceServers(data.iceServers);
  if (!iceServers) return new Response("TURN is unavailable", { status: 503 });
  return Response.json({
    iceServers,
    expires_at: Math.floor(Date.now() / 1000) + ttl
  }, { headers: privateHeaders() });
}

async function translatedVoice(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const room = await authorizedRoom(request, env);
  if (!room) return new Response("Forbidden", { status: 403 });
  const ttsEndpoint = httpsEndpoint(env.MODAL_TTS_URL);
  if (!env.MODAL_SHARED_SECRET || !ttsEndpoint) {
    return new Response("Translated voice is unavailable", { status: 503 });
  }
  if (contentLengthTooLarge(request, MAX_TTS_BODY_BYTES)) {
    return new Response("Request body is too large", { status: 413 });
  }
  const body = await readLimited(request.body, MAX_TTS_BODY_BYTES);
  if (!body) return new Response("Request body is too large", { status: 413 });
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    data = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400, headers: privateHeaders() });
  }
  if (typeof data.text !== "string" || data.text.length === 0
      || data.text.length > MAX_TTS_CHARS
      || !LANGUAGES.includes(data.lang as Language)
      || !VOICE_STYLES.includes(data.voice_style as VoiceStyle)) {
    return Response.json({ error: "invalid translated voice request" }, {
      status: 422, headers: privateHeaders()
    });
  }
  const participantId = request.headers.get("X-Participant-ID") || "";
  if (!/^[A-Za-z0-9_-]{16}$/.test(participantId)) {
    return new Response("Forbidden", { status: 403, headers: privateHeaders() });
  }
  const quotaHeaders = new Headers({
    "X-Room-Expires": String(room.expiresAt),
    "X-Participant-ID": participantId
  });
  const quota = await env.ROOMS.get(env.ROOMS.idFromName(room.id)).fetch(
    new Request("https://room.internal/tts-quota", {
      method: "POST", headers: quotaHeaders
    }));
  if (quota.status !== 204) {
    const headers = privateHeaders();
    const retryAfter = quota.headers.get("Retry-After");
    if (retryAfter) headers.set("Retry-After", retryAfter);
    return new Response(quota.status === 429 ? "Translated voice rate limit reached" : "Forbidden", {
      status: quota.status === 429 ? 429 : 403,
      headers
    });
  }
  const upstreamRequest = new Request(ttsEndpoint.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MODAL_SHARED_SECRET}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: data.text,
      lang: data.lang,
      voice_style: data.voice_style
    })
  });
  const upstream = env.MODAL_TEST
    ? await env.MODAL_TEST.fetch(upstreamRequest)
    : await fetch(upstreamRequest);
  if (!upstream.ok || !upstream.headers.get("Content-Type")?.startsWith("audio/wav")) {
    return new Response("Translated voice is unavailable", { status: 503 });
  }
  const audioLength = Number(upstream.headers.get("Content-Length") || "0");
  if (audioLength > MAX_TTS_AUDIO_BYTES) {
    return new Response("Translated voice is unavailable", { status: 503 });
  }
  const audio = await readLimited(upstream.body, MAX_TTS_AUDIO_BYTES);
  if (!audio || audio.byteLength <= 4
      || new TextDecoder().decode(audio.slice(0, 4)) !== "RIFF") {
    return new Response("Translated voice is unavailable", { status: 503 });
  }
  const headers = privateHeaders();
  headers.set("Content-Type", "audio/wav");
  return new Response(audio.buffer as ArrayBuffer, { headers });
}

export class Room extends DurableObject<Env> {
  // Ordinary memory is deliberately disposable. An active outbound Modal
  // socket keeps this object awake; after hibernation or process replacement,
  // the next PCM frame creates only that participant's compute stream again.
  private compute = new Map<string, ComputeState>();
  private pcmBudgets = new Map<string, PcmBudget>();

  private attachment(socket: WebSocket): ParticipantAttachment | null {
    const value = socket.deserializeAttachment() as ParticipantAttachment | null;
    return value?.kind === "browser" ? value : null;
  }

  private participants(): Array<{ socket: WebSocket; meta: ParticipantAttachment }> {
    return this.ctx.getWebSockets("browser").flatMap(socket => {
      const meta = this.attachment(socket);
      return meta?.joined ? [{ socket, meta }] : [];
    });
  }

  private publicParticipant(meta: ParticipantAttachment) {
    return {
      id: meta.id,
      lang: meta.lang,
      name: meta.name,
      voice_style: meta.voiceStyle
    };
  }

  private send(socket: WebSocket, message: object): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, "send failed");
    }
  }

  private broadcast(message: object, exclude?: WebSocket): void {
    for (const { socket } of this.participants()) {
      if (socket !== exclude) this.send(socket, message);
    }
  }

  private removeParticipant(
    socket: WebSocket,
    meta: ParticipantAttachment,
    reason: string,
    closeSocket: boolean
  ): void {
    if (!meta.joined) return;
    meta.joined = false;
    socket.serializeAttachment(meta);
    this.closeCompute(meta.id);
    this.pcmBudgets.delete(meta.id);
    this.broadcast({
      type: "peer_leave",
      id: meta.id,
      participant_count: this.participants().length,
      participant_limit: MAX_PARTICIPANTS
    }, socket);
    if (closeSocket) {
      try { socket.close(1000, reason.slice(0, 120)); } catch { /* already closed */ }
    }
  }

  private sweepExpiredSockets(now: number): void {
    const expired = this.ctx.getWebSockets("browser").flatMap(socket => {
      const meta = this.attachment(socket);
      return meta && (!Number.isFinite(meta.lastSeenAt)
        || now - meta.lastSeenAt >= PRESENCE_LEASE_MS)
        ? [{ socket, meta, wasJoined: meta.joined }] : [];
    });
    if (!expired.length) return;

    // Mark the whole expired set first so every leave event reports the same
    // final, accurate count and close callbacks cannot broadcast duplicates.
    for (const { socket, meta, wasJoined } of expired) {
      if (wasJoined) {
        meta.joined = false;
        socket.serializeAttachment(meta);
        this.closeCompute(meta.id);
        this.pcmBudgets.delete(meta.id);
      }
    }
    const participantCount = this.participants().length;
    for (const { socket, meta, wasJoined } of expired) {
      if (wasJoined) {
        this.broadcast({
          type: "peer_leave",
          id: meta.id,
          participant_count: participantCount,
          participant_limit: MAX_PARTICIPANTS
        }, socket);
      }
      try { socket.close(1000, "presence lease expired"); } catch { /* already closed */ }
    }
  }

  private leasedSocketCount(now: number): number {
    return this.ctx.getWebSockets("browser").filter(socket => {
      const meta = this.attachment(socket);
      // Missing attachment state is invalid and must still consume capacity.
      return !meta || (Number.isFinite(meta.lastSeenAt)
        && now - meta.lastSeenAt < PRESENCE_LEASE_MS);
    }).length;
  }

  private policyClose(socket: WebSocket, reason: string): void {
    socket.close(1008, reason.slice(0, 120));
  }

  private computeState(id: string): ComputeState {
    let state = this.compute.get(id);
    if (!state) {
      state = {
        socket: null, connecting: null, failures: 0, nextAttempt: 0,
        generation: 0, abort: null
      };
      this.compute.set(id, state);
    }
    return state;
  }

  private markComputeClosed(id: string, socket: WebSocket): void {
    const state = this.compute.get(id);
    if (!state || state.socket !== socket) return;
    state.socket = null;
    state.failures += 1;
    const delay = Math.min(
      COMPUTE_BACKOFF_MAX_MS,
      250 * 2 ** Math.min(state.failures, 5)
    );
    state.nextAttempt = Date.now() + delay;
  }

  private closeCompute(id: string): void {
    const state = this.compute.get(id);
    this.compute.delete(id);
    if (state) {
      state.generation += 1;
      state.abort?.abort();
      state.abort = null;
    }
    if (state?.socket) {
      try { state.socket.close(1000, "participant stream ended"); } catch { /* closed */ }
    }
  }

  private consumePcm(id: string, bytes: number): boolean {
    const now = Date.now();
    const budget = this.pcmBudgets.get(id) || { tokens: PCM_BURST_BYTES, updatedAt: now };
    budget.tokens = Math.min(
      PCM_BURST_BYTES,
      budget.tokens + (now - budget.updatedAt) * PCM_RATE_BYTES_PER_SECOND / 1000
    );
    budget.updatedAt = now;
    if (budget.tokens < bytes) {
      this.pcmBudgets.set(id, budget);
      return false;
    }
    budget.tokens -= bytes;
    this.pcmBudgets.set(id, budget);
    return true;
  }

  private consumeTts(participantId: string): { allowed: boolean; retryAfter: number } {
    this.sweepExpiredSockets(Date.now());
    const participants = this.participants();
    if (!participants.some(({ meta }) => meta.id === participantId)) {
      return { allowed: false, retryAfter: 0 };
    }
    const now = Date.now();
    const newest = participants.reduce((current, { meta }) =>
      meta.ttsWindowStart > current.ttsWindowStart ? meta : current,
    participants[0].meta);
    let windowStart = newest.ttsWindowStart || now;
    let count = newest.ttsCount || 0;
    if (now - windowStart >= TTS_WINDOW_MS) {
      windowStart = now;
      count = 0;
    }
    if (count >= TTS_REQUESTS_PER_WINDOW) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((windowStart + TTS_WINDOW_MS - now) / 1000))
      };
    }
    count += 1;
    for (const { socket, meta } of participants) {
      meta.ttsWindowStart = windowStart;
      meta.ttsCount = count;
      socket.serializeAttachment(meta);
    }
    return { allowed: true, retryAfter: 0 };
  }

  private async computeFetch(request: Request): Promise<Response> {
    return this.env.MODAL_TEST ? this.env.MODAL_TEST.fetch(request) : fetch(request);
  }

  private async ensureCompute(meta: ParticipantAttachment): Promise<WebSocket | null> {
    const state = this.computeState(meta.id);
    if (state.socket?.readyState === 1) return state.socket;
    if (state.connecting) return state.connecting;
    if (Date.now() < state.nextAttempt) return null;
    const endpoint = httpsEndpoint(this.env.MODAL_WS_URL);
    if (!this.env.MODAL_SHARED_SECRET || !endpoint) return null;
    const generation = state.generation;
    const controller = new AbortController();
    state.abort = controller;

    state.connecting = (async () => {
      try {
        const headers = new Headers({
          Authorization: `Bearer ${this.env.MODAL_SHARED_SECRET}`,
          Upgrade: "websocket"
        });
        const response = await this.computeFetch(new Request(endpoint.toString(), {
          headers, signal: controller.signal
        }));
        if (response.status !== 101 || !response.webSocket) throw new Error("compute refused");
        const socket = response.webSocket;
        if (this.compute.get(meta.id) !== state || state.generation !== generation) {
          try { socket.close(1000, "stale compute handshake"); } catch { /* not accepted */ }
          return null;
        }
        socket.accept();
        state.socket = socket;
        state.failures = 0;
        state.nextAttempt = 0;
        socket.addEventListener("message", event => {
          if (typeof event.data === "string") this.onComputeCaption(meta.id, event.data);
          else {
            try { socket.close(1008, "text captions required"); } catch { /* closed */ }
          }
        });
        socket.addEventListener("close", () => this.markComputeClosed(meta.id, socket));
        socket.addEventListener("error", () => this.markComputeClosed(meta.id, socket));
        socket.send(JSON.stringify({
          type: "start",
          stream_id: meta.id,
          source_lang: meta.lang,
          target_lang: meta.lang === "en" ? "es" : "en"
        }));
        return socket;
      } catch {
        if (this.compute.get(meta.id) !== state || state.generation !== generation) return null;
        state.socket = null;
        state.failures += 1;
        state.nextAttempt = Date.now() + Math.min(
          COMPUTE_BACKOFF_MAX_MS,
          250 * 2 ** Math.min(state.failures, 5)
        );
        return null;
      } finally {
        if (state.generation === generation) {
          state.connecting = null;
          state.abort = null;
        }
      }
    })();
    return state.connecting;
  }

  private onComputeCaption(participantId: string, raw: string): void {
    if (new TextEncoder().encode(raw).byteLength > MAX_COMPUTE_MESSAGE_BYTES) return;
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      data = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (data.type !== "caption" || typeof data.final !== "boolean"
        || !Number.isSafeInteger(data.seq) || (data.seq as number) < 0
        || typeof data.original !== "string"
        || (data.original as string).length > MAX_CAPTION_CHARS
        || !data.translations || typeof data.translations !== "object"
        || Array.isArray(data.translations)) return;
    const participant = this.participants().find(({ meta }) => meta.id === participantId);
    if (!participant) return;
    const translations: Partial<Record<Language, string>> = {};
    for (const lang of LANGUAGES) {
      const value = (data.translations as Record<string, unknown>)[lang];
      if (typeof value === "string" && value.length <= MAX_CAPTION_CHARS) {
        translations[lang] = value;
      }
    }
    const tMs = typeof data.t_ms === "number" && Number.isFinite(data.t_ms)
      ? Math.max(0, Math.round(data.t_ms)) : 0;
    this.broadcast({
      type: "caption",
      // The authenticated compute adapter still does not own room identity.
      // Attribution comes from the browser socket whose PCM opened this stream.
      speaker: participant.meta.id,
      speaker_lang: participant.meta.lang,
      seq: data.seq,
      final: data.final,
      original: data.original,
      translations,
      t_ms: tMs
    });
  }

  async fetch(request: Request): Promise<Response> {
    const expiresAt = Number(request.headers.get("X-Room-Expires"));
    if (!Number.isSafeInteger(expiresAt)
        || expiresAt <= Math.floor(Date.now() / 1000)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const storedExpiry = await this.ctx.storage.get<number>("expiresAt");
    if (storedExpiry !== undefined && storedExpiry <= Math.floor(Date.now() / 1000)) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return new Response("Unauthorized", { status: 401 });
    }
    if (storedExpiry !== undefined && storedExpiry !== expiresAt) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (storedExpiry === undefined) {
      await this.ctx.storage.put("expiresAt", expiresAt);
      await this.ctx.storage.setAlarm(expiresAt * 1000);
    } else if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(expiresAt * 1000);
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/tts-quota") {
      const participantId = request.headers.get("X-Participant-ID") || "";
      const result = this.consumeTts(participantId);
      if (result.allowed) return new Response(null, { status: 204 });
      if (!result.retryAfter) return new Response("Forbidden", { status: 403 });
      return new Response("Rate limit reached", {
        status: 429, headers: { "Retry-After": String(result.retryAfter) }
      });
    }
    if (request.method !== "GET"
        || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const now = Date.now();
    this.sweepExpiredSockets(now);
    if (this.leasedSocketCount(now) >= MAX_PENDING_SOCKETS) {
      return new Response("Room connection capacity reached", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const meta: ParticipantAttachment = {
      kind: "browser",
      id: base64url(crypto.getRandomValues(new Uint8Array(12))),
      joined: false,
      lang: "en",
      name: "Speaker",
      voiceStyle: "female",
      lastSeenAt: Date.now(),
      ttsWindowStart: 0,
      ttsCount: 0
    };
    server.serializeAttachment(meta);
    this.ctx.acceptWebSocket(server, ["browser"]);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const meta = this.attachment(socket);
    if (!meta) return this.policyClose(socket, "missing participant state");

    if (typeof message !== "string") {
      if (!meta.joined) return this.policyClose(socket, "join required");
      if (message.byteLength > MAX_PCM_FRAME_BYTES) {
        socket.close(1009, "microphone frame too large");
        return;
      }
      if (!this.consumePcm(meta.id, message.byteLength)) {
        this.closeCompute(meta.id);
        this.policyClose(socket, "microphone rate exceeded");
        return;
      }
      const now = Date.now();
      if (!Number.isFinite(meta.lastSeenAt)
          || now - meta.lastSeenAt >= PRESENCE_HEARTBEAT_MS) {
        meta.lastSeenAt = now;
        socket.serializeAttachment(meta);
        this.sweepExpiredSockets(now);
      }
      const compute = await this.ensureCompute(meta);
      if (compute?.readyState === 1) compute.send(message);
      // Frames are deliberately not queued while Modal reconnects. This bounds
      // memory and latency; natural peer audio remains independent and live.
      return;
    }
    if (new TextEncoder().encode(message).byteLength > CONTROL_MESSAGE_BYTES) {
      socket.close(1009, "control message too large");
      return;
    }
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(message) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      data = parsed as Record<string, unknown>;
    } catch {
      return this.policyClose(socket, "invalid JSON control message");
    }

    if (!meta.joined) {
      if (data.type !== "join") return this.policyClose(socket, "join required");
      this.sweepExpiredSockets(Date.now());
      const participants = this.participants();
      if (participants.length >= MAX_PARTICIPANTS) {
        this.send(socket, {
          type: "room_full",
          limit: MAX_PARTICIPANTS,
          participant_count: participants.length
        });
        socket.close(1013, "room full");
        return;
      }
      meta.joined = true;
      meta.lang = LANGUAGES.includes(data.lang as Language) ? data.lang as Language : "en";
      const requestedName = typeof data.name === "string" ? data.name.trim() : "";
      meta.name = requestedName.slice(0, 40) || "Speaker";
      meta.voiceStyle = VOICE_STYLES.includes(data.voice_style as VoiceStyle)
        ? data.voice_style as VoiceStyle : "female";
      meta.lastSeenAt = Date.now();
      if (participants.length) {
        meta.ttsWindowStart = participants[0].meta.ttsWindowStart || 0;
        meta.ttsCount = participants[0].meta.ttsCount || 0;
      }
      socket.serializeAttachment(meta);
      this.send(socket, {
        type: "welcome",
        id: meta.id,
        langs: [...LANGUAGES],
        tts_provider: "kokoro",
        participant_count: participants.length + 1,
        participant_limit: MAX_PARTICIPANTS,
        heartbeat_interval_ms: PRESENCE_HEARTBEAT_MS,
        presence_lease_ms: PRESENCE_LEASE_MS,
        peers: participants.map(({ meta: peer }) => this.publicParticipant(peer))
      });
      this.broadcast({
        type: "peer_join",
        ...this.publicParticipant(meta),
        participant_count: participants.length + 1,
        participant_limit: MAX_PARTICIPANTS
      }, socket);
      return;
    }

    meta.lastSeenAt = Date.now();
    socket.serializeAttachment(meta);
    this.sweepExpiredSockets(meta.lastSeenAt);

    if (data.type === "heartbeat") {
      this.send(socket, {
        type: "presence",
        participant_count: this.participants().length,
        participant_limit: MAX_PARTICIPANTS
      });
      return;
    }

    if (data.type === "leave") {
      this.removeParticipant(socket, meta, "left room", true);
      return;
    }

    if (data.type === "set_lang") {
      if (!LANGUAGES.includes(data.lang as Language)) {
        return this.policyClose(socket, "unsupported language");
      }
      meta.lang = data.lang as Language;
      socket.serializeAttachment(meta);
      this.closeCompute(meta.id);
      this.broadcast({ type: "peer_update", ...this.publicParticipant(meta) });
      return;
    }
    if (data.type === "set_voice_style") {
      if (!VOICE_STYLES.includes(data.voice_style as VoiceStyle)) {
        return this.policyClose(socket, "unsupported voice style");
      }
      meta.voiceStyle = data.voice_style as VoiceStyle;
      socket.serializeAttachment(meta);
      this.broadcast({ type: "peer_update", ...this.publicParticipant(meta) });
      return;
    }
    if (data.type === "speech_end") {
      const compute = await this.ensureCompute(meta);
      if (compute?.readyState === 1) compute.send(JSON.stringify({ type: "speech_end" }));
      return;
    }
    if (data.type === "signal") {
      if (typeof data.to !== "string" || !data.data || typeof data.data !== "object"
          || Array.isArray(data.data)) return this.policyClose(socket, "invalid signal");
      const target = this.participants().find(({ meta: peer }) => peer.id === data.to);
      if (target) this.send(target.socket, {
        type: "signal", from: meta.id, data: data.data
      });
      return;
    }
    // Captions are server-authored Modal output. Closing a browser that tries
    // to author one makes the privilege boundary explicit and fail-closed.
    this.policyClose(socket, "unsupported control message");
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    const meta = this.attachment(socket);
    if (meta?.joined) this.removeParticipant(socket, meta, reason || "socket closed", false);
    try {
      socket.close(code || 1000, reason.slice(0, 120));
    } catch {
      // The peer may already have completed the close handshake.
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const meta = this.attachment(socket);
    if (meta?.joined) this.removeParticipant(socket, meta, "socket error", false);
    try { socket.close(1011, "socket error"); } catch { /* already closed */ }
  }

  async alarm(): Promise<void> {
    for (const socket of this.ctx.getWebSockets("browser")) {
      const meta = this.attachment(socket);
      if (meta) this.closeCompute(meta.id);
      try { socket.close(1008, "room expired"); } catch { /* already closed */ }
    }
    this.pcmBudgets.clear();
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" }, {
        headers: { "Cache-Control": "no-store" }
      });
    }
    if (url.pathname === "/api/room") return roomPreflight(request, env);
    if (url.pathname === "/api/turn") return turnCredentials(request, env);
    if (url.pathname === "/tts") return translatedVoice(request, env);
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      return createRoomResponse(request, env, false);
    }
    if (request.method === "POST" && url.pathname === "/rooms") {
      return createRoomResponse(request, env, true);
    }
    const roomMatch = url.pathname.match(/^\/room\/([^/]+)$/);
    if (request.method === "GET" && roomMatch) {
      return roomPage(request, env, roomMatch[1]);
    }
    const socketMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (socketMatch) {
      if (request.method !== "GET"
          || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      if (!sameOrigin(request, env)) return new Response("Forbidden", { status: 403 });
      const room = await verifyRoom(socketMatch[1], env.ROOM_SIGNING_KEY);
      if (!room) return new Response("Unauthorized", { status: 401 });
      // Token verification precedes both idFromName() and get(): forged or
      // expired links never select, construct, or wake a Durable Object.
      const id = env.ROOMS.idFromName(room.id);
      const stub = env.ROOMS.get(id);
      const headers = new Headers(request.headers);
      headers.set("X-Room-Expires", String(room.expiresAt));
      return stub.fetch(new Request("https://room.internal/socket", { headers }));
    }
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    // FastAPI mounts the shared files at /static; Workers assets expose the
    // contents of that directory at /. Rewrite only that compatibility prefix.
    if (url.pathname.startsWith("/static/")) {
      url.pathname = url.pathname.slice("/static".length);
      return env.ASSETS.fetch(new Request(url, request));
    }
    const asset = await env.ASSETS.fetch(request);
    if (url.pathname !== "/sw.js" || !asset.ok) return asset;
    const headers = new Headers(asset.headers);
    headers.set("Service-Worker-Allowed", "/");
    headers.set("Cache-Control", "no-store");
    return new Response(asset.body, { status: asset.status, headers });
  }
} satisfies ExportedHandler<Env>;

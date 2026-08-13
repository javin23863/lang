# Platform implementation sources

Verified against primary sources on **2026-08-13**. This is an implementation
fact sheet, not a deployment receipt. Re-check the linked pages before changing
runtime versions or compatibility dates.

## Cloudflare Workers and Durable Objects

### Static assets

- Configure assets under `assets.directory`. An optional `assets.binding`
  exposes a `Fetcher` such as `env.ASSETS`, and
  `env.ASSETS.fetch(request)` returns the matched asset response. Only the URL
  pathname is used for asset matching.
- The default is asset-first: a matching asset is served without invoking the
  Worker, and the Worker runs when no asset matches. Set
  `assets.run_worker_first: true` to run code for every request, or use the
  documented route-pattern array to run it only for selected paths. Negative
  patterns take precedence.
- For an SPA, `assets.not_found_handling: "single-page-application"` serves
  `index.html` for unmatched navigation requests. Do not use that fallback for
  API/WebSocket paths unless those paths are routed to Worker code first.

Sources: [static-asset configuration and binding](https://developers.cloudflare.com/workers/static-assets/binding/),
[Worker-script routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/),
[SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

### Stable room identity

- `namespace.idFromName(name)` maps a name to a named `DurableObjectId` in that
  namespace; `namespace.get(id)` returns its stub. The current shorthand is
  `namespace.getByName(name)`.
- Treat the namespace and any jurisdiction restriction as part of the identity
  domain: the same text name can map to a different ID in another namespace or
  jurisdiction. Normalize and validate a room name before using it as the
  lookup key.
- Creating an ID or stub does not eagerly construct the object; construction is
  lazy on access. The first global use of a name-derived ID can incur extra
  placement latency while Cloudflare guarantees a single instance.

Sources: [Durable Object namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/),
[Durable Object ID API](https://developers.cloudflare.com/durable-objects/api/id/),
[data-location/jurisdiction behavior](https://developers.cloudflare.com/durable-objects/reference/data-location/).

### Hibernating WebSockets

- Use a `WebSocketPair`, return the client end in a `101` response, and pass the
  server end to `this.ctx.acceptWebSocket(server, tags?)`. Calling `server.accept()`
  instead uses the standard WebSocket API and does **not** opt the connection
  into Durable Object hibernation.
- Implement `webSocketMessage`, `webSocketClose`, and, where needed,
  `webSocketError` methods on the Durable Object. During hibernation, clients
  stay connected but in-memory state is discarded; the constructor runs again
  when an event wakes the object.
- On construction, call `this.ctx.getWebSockets(tag?)` to recover all currently
  attached sockets or the sockets matching a tag. The documented ceiling is
  32,768 connections per object, subject to lower practical CPU/memory limits;
  each socket may have at most 10 tags, each at most 256 characters. Persist
  small per-connection state with
  `ws.serializeAttachment(value)` and restore it with
  `ws.deserializeAttachment()`. Attachments use structured clone, survive
  hibernation only while the socket stays healthy, are lost on close, and have
  a documented maximum serialized size of 16,384 bytes. Persist larger or
  longer-lived room state in Durable Object storage.
- Version-sensitive behavior: with compatibility date `2026-04-07` or later
  and `web_socket_auto_reply_to_close`, the runtime replies to Close frames;
  calling `ws.close(code, reason)` remains safe but is no longer required.

Sources: [Durable Object State API and limits](https://developers.cloudflare.com/durable-objects/api/state/),
[Durable Objects WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[hibernation server example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/).

### Strict handshake and Origin gate

- Cloudflare's Worker example checks for `Upgrade: websocket` before creating a
  pair and returns `426` otherwise. Its Durable Object example also restricts
  the route to `GET`. Keep those application gates before forwarding to the
  room object.
- RFC 6455 requires the client handshake to use `GET`, include an `Upgrade`
  value containing the `websocket` token and a `Connection` value containing
  the `Upgrade` token, and include `Sec-WebSocket-Key` and
  `Sec-WebSocket-Version`. Browser clients must send `Origin`.
- For this browser-only room surface, compare the parsed `Origin` against an
  explicit exact allowlist of canonical scheme/host/port values and reject a
  missing, malformed, opaque (`null`), or non-member origin before returning
  `101`. This is an implementation inference from RFC 6455's cross-origin
  security model; CORS response headers are not a substitute for the WebSocket
  opening-handshake check. Header names and protocol tokens are
  case-insensitive, so token parsing should not depend on casing.

Sources: [Cloudflare Workers WebSocket example](https://developers.cloudflare.com/workers/examples/websockets/),
[RFC 6455 opening handshake and Origin security](https://www.rfc-editor.org/rfc/rfc6455.html#section-4.2.1),
[RFC 6455 security considerations](https://www.rfc-editor.org/rfc/rfc6455.html#section-10.2).

## Cloudflare Realtime TURN

- A TURN key is a long-lived server-side secret and cannot itself authenticate
  to `turn.cloudflare.com`. Keep both its key ID and API token off the client.
- Issue short-lived ICE credentials from a backend with:

  `POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers`

  Send `Authorization: Bearer {TURN_KEY_API_TOKEN}` and JSON such as
  `{"ttl": 86400}`. A successful call returns `201` with an `iceServers` array
  that can be passed to `RTCPeerConnection`.
- Generate credentials per user/session and set the TTL longer than the
  expected call. Cloudflare documents a maximum expiry of 48 hours (172,800
  seconds); refresh an active peer connection with `setConfiguration()` before
  expiry if necessary. The response does not echo the TTL, so the issuing
  backend must retain its own expiry metadata if the application needs it.
- The returned list includes port 53 alternatives, which Cloudflare notes are
  blocked by known browsers. With non-trickle ICE, filter those URLs to avoid a
  timeout; with trickle ICE their timeout does not block candidate gathering.

Sources: [generate TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/),
[TURN FAQ and 48-hour maximum](https://developers.cloudflare.com/realtime/turn/faq/).

## Modal serving/runtime facts

### ASGI, web servers, and WebSockets

- Current SDK syntax for an ASGI app is an `@app.function(...)` decorated with
  `@modal.concurrent(max_inputs=...)` and `@modal.asgi_app()`, returning the
  ASGI application. A non-ASGI process uses `@modal.web_server(port)` and must
  listen on `0.0.0.0`, not only `127.0.0.1`.
- `@modal.asgi_app`, `@modal.wsgi_app`, and `@modal.web_server` support
  WebSockets. Each WebSocket connection occupies one Function input; set
  `@modal.concurrent(max_inputs=N)` so one container can handle multiple
  connections. Above the per-container limit Modal starts more containers;
  once the Function's container limit is reached, requests queue.
- Modal currently documents RFC 6455 support but not RFC 8441 (WebSockets over
  HTTP/2) or RFC 7692 (`permessage-deflate`). A WebSocket message is limited to
  2 MiB.
- Version-sensitive syntax: `@modal.fastapi_endpoint` replaced the former
  `@modal.web_endpoint` name before SDK `0.73.82`; Modal 1.0 replaced
  `allow_concurrent_inputs=N` with `@modal.concurrent(max_inputs=N)`. Pin the
  Modal SDK and use its matching documentation.
- A WebSocket holds one Function input for its connection lifetime. Ordinary
  Function executions default to a 300-second timeout and allow an explicit
  timeout from 1 second through 24 hours. It follows that a production room
  should set an intentional `timeout` for its supported maximum connection
  lifetime rather than inherit the default; this is an implementation
  inference because the WebSocket page does not publish a separate lifetime
  limit.

Sources: [Modal Web Functions](https://modal.com/docs/guide/webhooks),
[input concurrency](https://modal.com/docs/guide/concurrent-inputs),
[Modal 1.0 migration](https://modal.com/docs/guide/modal-1-0-migration),
[Function timeouts](https://modal.com/docs/guide/timeouts).

### Concurrency and container bounds

- `@modal.concurrent(max_inputs=N, target_inputs=M)` sets the hard concurrent
  input count per container and an autoscaler target. Synchronous functions
  run concurrent inputs on threads and must be thread-safe; asynchronous
  functions use asyncio tasks on one thread and must not block the event loop.
- Set `max_containers` on `@app.function(...)` to bound the Function's
  concurrent container pool. `min_containers`, `buffer_containers`, and
  `scaledown_window` trade cost for cold-start latency;
  `scaledown_window` is the maximum seconds an idle container remains before
  scaling down. Modal scales to zero by default when there is no input. The
  documented default idle maximum is 60 seconds, configurable from 2 seconds
  through 20 minutes; idle reserved resources remain billable.
- Account/workspace quotas are separate from application bounds. Modal's Web
  Functions page currently states that a new workspace starts at 200 Function
  calls or HTTP requests per second with a five-second burst; excess requests
  return `429`. Treat that number as plan-sensitive and verify it for the
  actual workspace.

Sources: [input concurrency](https://modal.com/docs/guide/concurrent-inputs),
[scaling controls](https://modal.com/docs/guide/scale),
[cold-start and scaledown-window bounds](https://modal.com/docs/guide/cold-start),
[Web Function scaling/limits](https://modal.com/docs/guide/webhooks).

### GPU, model cache, Volume, and secrets

- Request an NVIDIA L4 with `gpu="L4"` on `@app.function(...)`. Hardware
  availability, pricing, and allowed GPU counts are current-platform facts,
  so verify the GPU page at deployment time.
- Modal recommends a `Volume` for model weights. Current syntax is
  `modal.Volume.from_name(name, create_if_missing=True)` and
  `volumes={mount_path: volume}`. A container sees the latest snapshot when it
  starts; call `volume.reload()` to see a commit made by another live container
  and `volume.commit()` when a write must be visible outside the writer.
  Volumes also background-commit every few seconds and on container shutdown,
  but explicit commit is the deterministic handoff point.
- For Hugging Face weights, use `snapshot_download(..., revision=<commit>)`;
  Modal's own model-weight example explicitly recommends including a revision
  to prevent surprises. A single fixed model can instead be baked into an
  Image with `Image.run_function`, but Modal recommends Volumes when decoupling
  model storage from image rebuilds.
- Inject credentials with
  `secrets=[modal.Secret.from_name("name")]`; keys become environment variables
  inside the container. Named secrets are environment-scoped. Do not bake
  secret values into an Image or repository.

Sources: [Modal GPU types](https://modal.com/docs/guide/gpu),
[Volumes](https://modal.com/docs/guide/volumes),
[model weights and revision pinning](https://modal.com/docs/guide/model-weights),
[Secrets](https://modal.com/docs/guide/secrets).

## Kokoro provenance and license

- The official Python runtime is the `kokoro` package from Hexgrad. Its current
  published release is `kokoro==0.9.4`; the project metadata requires Python
  `>=3.10,<3.13` and declares Apache-2.0. The runtime repository's `LICENSE` is
  Apache License 2.0.
- Provenance anchor for the universal wheel:
  `kokoro-0.9.4-py3-none-any.whl`, SHA-256
  `a129dc6364a286bd6a92c396e9862459d3d3e45f2c15596ed5a94dcee5789efd`.
  Use a lockfile/requirements hash check; `kokoro==0.9.4` alone does not pin its
  transitive dependencies because its metadata leaves several dependencies
  unbounded and specifies only `misaki[en]>=0.9.4`.
- The official model repository is `hexgrad/Kokoro-82M`, marked
  `apache-2.0`. Pin model downloads to Hugging Face commit
  `f3ff3571791e39611d31c381e3a41a3af07b4987`, not mutable `main`. At that
  revision, `kokoro-v1_0.pth` has LFS SHA-256
  `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4`.
- Important runtime caveat: the current `KModel`/`KPipeline` source defaults to
  `hexgrad/Kokoro-82M` and calls `hf_hub_download` without a `revision`
  argument for config, weights, and voices. For an immutable deployment,
  pre-fetch the pinned snapshot into the mounted cache and load explicit local
  files (or otherwise verify the cache contents); merely pinning the Python
  package does not pin model artifacts.
- Repository provenance is weaker than PyPI provenance: the GitHub project has
  no published Git tag matching `0.9.4`. Do not invent a source tag. The
  inspected current source commit was
  `dfb907a02bba8152ca444717ca5d78747ccb4bec`; use the PyPI wheel/hash as the
  package artifact anchor and the Hugging Face commit/hash as the model anchor.

Sources: [PyPI release metadata and artifact hashes](https://pypi.org/pypi/kokoro/0.9.4/json),
[official runtime metadata](https://github.com/hexgrad/kokoro/blob/dfb907a02bba8152ca444717ca5d78747ccb4bec/pyproject.toml),
[runtime license](https://github.com/hexgrad/kokoro/blob/dfb907a02bba8152ca444717ca5d78747ccb4bec/LICENSE),
[current model-loading source](https://github.com/hexgrad/kokoro/blob/dfb907a02bba8152ca444717ca5d78747ccb4bec/kokoro/model.py),
[current pipeline/voice-loading source](https://github.com/hexgrad/kokoro/blob/dfb907a02bba8152ca444717ca5d78747ccb4bec/kokoro/pipeline.py),
[official model repository and license](https://huggingface.co/hexgrad/Kokoro-82M/tree/f3ff3571791e39611d31c381e3a41a3af07b4987).

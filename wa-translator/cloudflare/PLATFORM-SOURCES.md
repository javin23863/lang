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

## Latency facts and experiment order

No number in this section is a measured latency result for this deployment.
**Repository fact** describes the inspected code, **source fact** comes from a
linked primary source, and **recommendation** is an architecture inference that
still needs a controlled English/Spanish run.

### Current critical path

- **Repository fact:** `pcm-worklet.js` sends 100 ms PCM frames. `modal_app.py`
  first permits a partial after 0.8 seconds of speech, schedules later partials
  every 0.4 seconds, and declares an endpoint after 500 ms of silence. Each
  partial re-decodes the utterance-so-far; the shared faster-whisper instance
  serializes decodes. OPUS-MT then returns a complete greedy translation.
- **Repository fact:** translated voice starts only from a final caption.
  Kokoro completes each yielded segment, Modal concatenates every segment into
  one WAV, the Worker reads the full upstream body, and the browser waits for a
  full `Blob` before playback. A generator in one library therefore does not
  make this end-to-end path streaming.
- **Recommendation:** before changing a threshold or model, add monotonic stage
  durations for queue wait, endpoint, ASR, MT, TTS, Worker first byte, and
  client playback, plus one client-observed end-to-end duration. Report cold
  and warm starts separately and bucket by language, utterance length,
  concurrency, and `MODAL_REGION`; do not subtract clocks from different
  machines.

### ASR, browser audio, and endpointing

- **Source fact:** faster-whisper's `segments` iterator is lazy execution, not a
  live-audio protocol. Its own README lists Whisper-Streaming as a separate
  wrapper. That project's paper/repository explains why naive fixed windows can
  split words and uses repeated updates plus a local-agreement policy to commit
  stable prefixes.
- **Source fact:** OpenAI lists multilingual `turbo` at 809M parameters, about
  6 GB VRAM, and about 8x the relative speed of `large` on its English/A100
  comparison, while warning that real speed varies with language and hardware.
  `distil-whisper/distil-large-v3` is explicitly tagged and used as an
  English-language ASR model, so it is not an English/Spanish replacement.
- **Source fact:** Web Audio runs `AudioWorkletProcessor` code on the audio
  rendering thread. `MediaRecorder(timeslice)` may use a larger user-agent
  minimum, so it is not an exact low-latency framing clock. WebRTC stats'
  `audioLevel` also averages over an implementation-defined interval. Silero
  VAD supports sequential 8/16 kHz chunks and publishes a 30+ ms chunk path;
  those facts do not prescribe an utterance-end silence threshold.
- **Recommendation:** keep AudioWorklet capture and server-side Silero as the
  authority. First A/B the endpoint-silence and partial cadence with false-cut,
  hallucination, and bilingual transcript gates. Test 50 ms versus the current
  100 ms wire frame only if capture-to-Modal timing is material: those sizes
  derive to 20 versus 10 incoming messages/second/speaker, and Cloudflare
  recommends 50-100 ms WebSocket batching to reduce context switches and
  request count. Do not jump to 32 ms merely because Silero evaluates roughly
  32 ms internally.
- **Recommendation:** keep the multilingual `large-v3-turbo` baseline. If ASR
  compute dominates after staging, compare smaller official multilingual
  Whisper sizes on paired English/Spanish fixtures under identical endpointing
  and decoding settings; exclude English-only Distil-Whisper from that trial.

Sources: [faster-whisper execution and streaming integrations](https://github.com/SYSTRAN/faster-whisper#usage),
[Whisper-Streaming paper](https://aclanthology.org/2023.ijcnlp-demo.3/),
[Whisper-Streaming policy and chunking caveats](https://github.com/ufal/whisper_streaming#background),
[OpenAI Whisper model table](https://github.com/openai/whisper#available-models-and-languages),
[Distil-Whisper model card](https://huggingface.co/distil-whisper/distil-large-v3),
[Web Audio processing model](https://www.w3.org/TR/webaudio/#processing-model),
[MediaRecorder timeslice algorithm](https://www.w3.org/TR/mediastream-recording/#mediarecorder-api),
[WebRTC audio-level interval](https://www.w3.org/TR/webrtc-stats/#dom-rtcaudiosourcestats-audiolevel),
[Silero VAD capabilities](https://github.com/snakers4/silero-vad),
[Durable Object WebSocket batching](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[Durable Object request accounting](https://developers.cloudflare.com/durable-objects/platform/pricing/).

### OPUS-MT and incremental output

- **Source fact:** OPUS-MT models are Marian neural translation models trained
  on OPUS data and primarily use SentencePiece segmentation. CTranslate2
  recommends int8 on CPU and `beam_size=1` for lower translation cost; the
  current adapter already uses both and preloads both room directions.
- **Source fact:** CTranslate2 can yield target tokens with `generate_tokens`,
  or invoke a per-token callback from `translate_batch` when beam size is one.
  This streams decoding of a complete source-token sequence; it does not make
  an unstable ASR source prefix final.
- **Recommendation:** keep the current full-result OPUS-MT call unless staged
  timings show MT is material. A token callback could update caption previews,
  but it adds cancellation, detokenization, and revision semantics while final
  TTS must still wait for stable text. Validate translation quality separately
  in both directions before changing the pinned models.

Sources: [OPUS-MT architecture and model provenance](https://github.com/Helsinki-NLP/Opus-MT),
[CTranslate2 Translator token and batch APIs](https://opennmt.net/CTranslate2/python/ctranslate2.Translator.html),
[CTranslate2 performance guidance](https://opennmt.net/CTranslate2/performance.html),
[current English-to-Spanish model card](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-es),
[current Spanish-to-English model card](https://huggingface.co/Helsinki-NLP/opus-mt-es-en).

### TTS first audio

- **Repository/source fact:** `modal_app.py` constructs one `KModel` and passes
  it into both `KPipeline` instances. In the pinned Kokoro source, `KModel`
  loads its checkpoint with `map_location='cpu'`, and `KPipeline` only performs
  automatic `.to(device).eval()` placement when it constructs the model
  itself; a supplied `KModel` is retained as-is. The current Kokoro synthesis
  path therefore stays on CPU even though the Modal container has an L4.
- **Source fact:** the pinned Kokoro `KPipeline` is a generator, but it calls
  `KPipeline.infer` before yielding each segment. Its non-English path chunks at
  roughly 400 characters; this app caps TTS input at 300 characters. The
  official repository publishes no time-to-first-audio guarantee for this
  stack and warns that very short utterances can be weaker.
- **Source fact:** maintained Piper exposes a C API that returns successive
  `piper_audio_chunk` values and lists English plus several Spanish locales.
  The engine is GPL-3.0 and each voice has its own model-card license. Its
  official sources likewise publish no first-byte result for this architecture.
- **Recommendation:** after adding stage timing, make the first TTS A/B the
  current placement versus explicit `KModel(...).to('cuda').eval()` on the L4,
  checking cold start, synthesis duration, GPU memory, output equivalence, and
  English/Spanish voice quality. This is smaller and better isolated than a
  provider or transport change; it is an experiment, not a measured speedup.
- **Recommendation:** a provider swap alone cannot remove the current three
  full-body buffers. If translated-voice timing is the bottleneck, prototype
  framed PCM from synthesis through a streaming Worker response into scheduled
  browser playback, with cancellation and natural-audio recovery preserved.
  Cloudflare explicitly recommends response streaming for lower first-byte
  time. Keep Kokoro until the same phrases show that synthesis, rather than
  buffering or cold start, is the limiting stage; treat Piper as a licensed
  A/B candidate, not an assumed faster replacement.

Sources: [pinned Kokoro model loading](https://github.com/hexgrad/kokoro/blob/dfb907a02bba8152ca444717ca5d78747ccb4bec/kokoro/model.py#L54-L68),
[pinned Kokoro pipeline placement and inference](https://github.com/hexgrad/kokoro/blob/dfb907a02bba8152ca444717ca5d78747ccb4bec/kokoro/pipeline.py#L58-L110),
[pinned Kokoro pipeline generation](https://github.com/hexgrad/kokoro/blob/dfb907a02bba8152ca444717ca5d78747ccb4bec/kokoro/pipeline.py#L386-L442),
[Kokoro voice limitations and Spanish routes](https://huggingface.co/hexgrad/Kokoro-82M/blob/f3ff3571791e39611d31c381e3a41a3af07b4987/VOICES.md),
[maintained Piper repository and GPL-3.0 license](https://github.com/OHF-Voice/piper1-gpl),
[Piper chunk API](https://github.com/OHF-Voice/piper1-gpl/blob/main/libpiper/README.md),
[Piper languages and per-voice license warning](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md),
[Cloudflare response-streaming guidance](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies).

### Modal cold starts, geography, and concurrency

- **Source fact:** scale-from-zero adds both queueing and one-time container
  initialization. `min_containers`, `buffer_containers`, and a longer
  `scaledown_window` trade more idle resources for fewer cold starts. The
  current `min_containers=0`, one-container, 60-second window is consequently
  a cost-oriented scale-to-zero choice, not the lowest-latency choice.
- **Source fact:** Modal CPU memory snapshots capture imports/CPU state. GPU
  snapshots are alpha; Modal warns that snapshots do not speed storage-bound
  model-weight loading and can add overhead. Snapshotting work must run before
  capture, while this app currently initializes ASR/MT/TTS lazily from its
  first request.
- **Source fact:** `@modal.concurrent(max_inputs=5, target_inputs=5)` controls
  accepted inputs and autoscaler targets; it does not promise five parallel
  neural decodes. Modal specifically warns that concurrency can be
  counterproductive for CPU-bound work. In this app, model locks remain the
  effective serialization boundary.
- **Source fact:** Modal routes Function inputs through `us-east` by default
  even when a container runs elsewhere. A `routing_region` can reduce network
  overhead, while a pinned container region carries a documented price
  multiplier and a narrower resource pool can worsen cold-start availability.
- **Source fact:** the Durable Object's outbound Modal WebSocket prevents
  hibernation and incurs duration while it keeps the object alive, but only for
  up to 15 minutes per connection; the connection is not a permanent residency
  guarantee.
- **Recommendation:** preserve scale-to-zero for the free-first beta. If cold
  initialization dominates, trial memory snapshots on the same L4 and pinned
  artifacts before paying for a warm container; include snapshot creation and
  restore cases and verify bilingual model readiness. Change concurrency only
  after recording queue wait and GPU utilization. Log `MODAL_REGION`, and set
  routing/container geography only from observed user distribution. Keep the
  existing compute reconnect path and classify post-eviction reconnects as
  cold or warm instead of assuming the outbound socket keeps the object alive.

Sources: [Modal cold-start controls and cost tradeoff](https://modal.com/docs/guide/cold-start),
[Modal memory snapshots and limitations](https://modal.com/docs/guide/memory-snapshots),
[Modal input concurrency](https://modal.com/docs/guide/concurrent-inputs),
[Modal region selection and routing](https://modal.com/docs/guide/region-selection),
[`MODAL_REGION` runtime variable](https://modal.com/docs/guide/environment_variables),
[Durable Object outbound-connection lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

### Recommended experiment order

1. Add stage timing without changing behavior; establish cold/warm English and
   Spanish distributions and record quality/refusal outcomes beside latency.
2. A/B current Kokoro CPU placement against explicit
   `KModel(...).to('cuda').eval()` on the L4; keep the change only if the staged
   bilingual results justify its cold-start and GPU-memory cost.
3. Tune endpoint silence and partial cadence; only then A/B 50/100 ms wire
   frames. Preserve the current false-cut, hallucination, and rate-limit gates.
4. If cold initialization dominates, test Modal snapshots; add a warm container
   only when the measured latency target justifies its idle cost.
5. If optional voice still dominates, stream audio end-to-end before comparing
   Kokoro with Piper. A library generator or chunk API is not acceptance proof.
6. Change Whisper size, OPUS-MT model, concurrency, or region last, one variable
   at a time. No source above is a substitute for a local bilingual p50/p95 and
   quality run on the deployed path.

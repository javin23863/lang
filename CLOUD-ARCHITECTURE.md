# Cloud caption room — implementation contract

> STATUS 2026-08-14: multilingual implementation is locally gated; public
> deployment and its named model receipts are tracked separately. A8 remains
> partial and A11 remains unmet until the required human-observable receipt.

## Product boundary

The product is a private multilingual video room. WhatsApp only carries the
invitation link. Inside the room, WebRTC carries each person's natural camera
and microphone stream while one source transcription fans out to the unique
base Languages of current listeners (maximum three targets).

The shared catalog declares 100 M2M100 base text Languages, 122 BCP-47 Locale
profiles, and six release-tested live-speech Languages: Arabic, German,
English, Spanish, French and Japanese. A Locale maps to one base Language and
never implies a dialect-specific ASR/MT model or quality claim.

Translated speech is a separate listening mode, never the definition of a
working room. Each participant controls their own device independently:

- **Captions only** is the default. Natural incoming speech remains audible.
- **Translated voice** locally mutes incoming natural speech and plays translated
  phrases. It never changes what another participant hears.
- An exact **Voice Profile** selects the voice heard on that device. The UI
  offers female/male choices only where the selected target Locale declares
  them; it never infers voice, gender or identity from a person. French has one
  enabled female profile. Arabic and German are captions-only in this release.
- Captions remain visible in every mode. A voice failure immediately restores
  natural incoming audio and leaves captions running.

"Real time" means phrase-level translated playback after a final transcript.
It does not promise simultaneous voice conversion or imitation of a person's
biometric voice.

## Smallest production structure

```text
WhatsApp invitation
        |
        v
Cloudflare Worker + static assets (always available)
  - creates and validates 24-hour signed bearer room links
  - returns a separate, domain-separated host-control bearer only to the
    same-origin creator dashboard
  - serves the installable phone and Windows host dashboard web app
  - issues short-lived Cloudflare TURN credentials
        |
        | signed room token
        v
one Cloudflare Durable Object per room
  - owns presence, WebRTC signalling and caption fan-out
  - records a closed tombstone through room expiry and terminally closes
    current browser sockets on host revocation
  - terminates browser WebSockets and survives hibernation
  - adds server-only credentials to Modal requests
        |
        | authenticated WebSocket / HTTP proxy
        v
Modal ASGI app (starts on demand)
  - each microphone stream -> Whisper ASR once -> M2M100 captions to unique targets
  - optional exact-profile Kokoro speech for English/Spanish/French/Japanese
        |
        v
Browser WebRTC peer connection
  - natural camera/microphone media remains peer-to-peer
  - TURN relays encrypted WebRTC only when direct connection fails
```

Cloudflare is the permanent control plane; it does not run the neural models.
During an active call its room Durable Object proxies microphone PCM to Modal so
Modal credentials never enter browser code. Modal is a stateless compute adapter
and may scale to zero when no room is active. The current Windows FastAPI host
remains the local development adapter and is not required by the public URL.

The public browser-to-room WebSocket is the main interface under test. Cloud
deployment adds signed-room validation and an allowed-origin check without
forking the caption protocol. The Durable Object deterministically selected by
room ID is the room module. It restores per-socket participant metadata from
WebSocket attachments after hibernation and treats all ordinary memory as
disposable. One shared protocol keeps the browser compatible with both the local
and cloud adapters.

## Repository shape

```text
wa-translator/
  cloudflare/              Worker, static-asset configuration and Worker tests
  capabilities.json        canonical Language/Locale/Capability/Voice Profile catalog
  modal_app.py             Modal image, pinned models, limits and ASGI entrypoint
  MULTILINGUAL-SOURCES.md  primary-source coverage/license/checksum decision record
  windows/                 existing local adapter and its integration tests
  windows/static/          one shared browser client, served by both adapters
```

No account system, framework rewrite, native mobile wrapper or custom domain is
required for this free-first wave. A cryptographically signed room URL is valid
for 24 hours and carries no personal data. Durable Object storage holds only the
room expiry needed to reject stale tokens; presence, captions and media remain
ephemeral.

## Runtime and cost controls

- Start with at most one Modal L4 container and four participants per room. The
  container exposes four reserved stream inputs **across all rooms** plus one
  bounded TTS input. If all global stream slots are in use, the Worker reports
  an explicit capacity status to the affected speaker and drops only stale
  caption PCM; natural peer media remains live. Each participant stream is
  independent, so correctness never depends on two Modal WebSockets retaining
  the same process. This is an explicit beta ceiling, not a scale claim.
- The GPU is primarily for low-latency Whisper transcription and M2M100
  CTranslate2 (`int8_float16`), and also accelerates Kokoro when a declared
  Voice Profile is enabled. Local CPU parity can read an explicitly
  pre-provisioned cache for contract development only; it never downloads or
  converts this model lane and is not a production-quality receipt.
- Modal scales to zero after the last active connection. Model files use a
  persistent Modal Volume so a container restart does not download them again.
  A process restart loses in-memory decoder state; the Durable Object reconnects
  the affected compute stream and the browser keeps natural media/captions UI
  alive while it warms.
- Cloudflare static assets and Worker requests stay on the free tier initially.
- The room uses Cloudflare's hibernation WebSocket interface. An active outbound
  Modal socket prevents hibernation only while translation compute is in use.
- Joined browsers send a hibernation-safe presence heartbeat every 10 seconds.
  A clean close or the visible Leave control releases the slot immediately; a
  silent half-open mobile connection is removed at the next heartbeat or join
  once its 90-second lease has elapsed. The four-person cap counts only live
  leases, and an unjoined socket cannot occupy one of the eight pending slots
  beyond the same 90-second attachment lease.
- TURN credentials are short-lived; the long-lived TURN key and room-signing key
  exist only as Cloudflare/Modal secrets and never enter git or the browser.

## Confirmed test seams

The user confirmed these user-facing seams by approving the room controls and
saying `begin`:

1. **Room URL interface:** create, open, expire, revoke and reject a bearer room.
2. **Host-control interface:** inspect and close exactly one room through a
   same-origin, separate host bearer; the participant URL cannot close it.
3. **Room WebSocket interface:** join, signal, stream microphone PCM and receive
   room-scoped captions without cross-room leakage.
4. **Participant listening interface:** captions-only default, independent voice
   toggle, remote-audio routing, voice selection and failure recovery.
5. **Deployment interface:** a permanent Cloudflare URL reaches a scale-to-zero
   Modal backend without the Windows computer running.

Tests exercise these interfaces, not private helpers. External Cloudflare,
Modal and TURN calls may be replaced only at their true network seams.

## Acceptance matrix

| ID | Acceptance row | Required receipt |
|---|---|---|
| A1 | A newly joined participant is in captions-only mode; natural remote audio/video is enabled and no translated audio starts. | Browser integration test plus visible two-tab receipt |
| A2 | Either participant can enable or disable translated voice without changing the other participant's mode. Captions continue in both states. | Two-client browser integration test |
| A3 | An exact selected Voice Profile resolves only to its catalog-declared Kokoro route. Female/male controls appear only when a matching profile exists; French remains female-only and unsupported languages remain captions-only. | Deterministic routing test plus pinned-profile WAV probes |
| A4 | Enabling translated voice locally mutes incoming natural audio before translated playback; disabling it, playback failure, watchdog expiry, reconnect or peer leave restores natural audio. | Browser lifecycle tests |
| A5 | Spoken output never feeds back into that participant's ASR stream; the WebRTC microphone track sent to the peer is not muted by that guard. | Existing echo-loop regression plus mode-specific browser test |
| A6 | Fixed EN↔ES, EN→FR/DE/JA/AR and ES→FR M2M fixtures produce correctly attributed final captions through the public protocol. Partials remain latest-wins and finals are never dropped. | Pinned-M2M receipt endpoint, source fixtures and public stream probe |
| A7 | Room IDs are 24-hour signed bearer tokens; forged, expired and cross-room signalling/caption attempts fail closed. The Worker verifies before selecting a Durable Object. Browser and TTS requests are origin/token/body limited, and Modal rejects any request without its server-only credential. | Python and Worker security tests |
| A8 | The Cloudflare deployment serves a permanent HTTPS room creator and shareable `/room/<token>` URL while the Windows host is stopped. All clients for a room deterministically reach one Durable Object. A Modal process replacement reconnects only the independent compute streams and never declares the room dead or drops the natural WebRTC call. | Live URL, health and cold-start/replacement receipt |
| A9 | WebRTC uses Cloudflare TURN credentials when direct ICE cannot connect; credentials are short-lived and no long-lived secret reaches client code or git. | Configuration test and relay-candidate browser receipt |
| A10 | Phone layout at 360 CSS pixels exposes Share, Leave, microphone, camera, translated-voice mode and voice choice without horizontal overflow. | Browser viewport assertion and screenshot |
| A11 | A real two-person Codex in-app-browser run shows video, carries natural audio in captions-only mode, displays supported multilingual captions, and audibly exercises only visible declared voice profiles. Automation alone cannot satisfy this row. | Human-observable acceptance receipt |
| A12 | Modal has a one-container/four-participant beta ceiling, concurrent WebSocket configuration, scale-to-zero and persistent model cache. The Durable Object uses hibernation attachments and stores no media/caption history. Documentation states cold-start, short-utterance voice quality, licensing and cost ceilings. | Configuration assertions and deployment documentation |
| A13 | The installed host dashboard creates, copies/shares, opens, persists and terminally closes a room. Host control is never in the participant URL; close disconnects current sockets and makes future page, preflight and WebSocket access fail through expiry. | Worker host-control tests, fresh-public-browser flow and Windows shortcut receipt |

## Deliberate ceilings

- One active GPU container is the free-first beta. Multi-container compute comes
  only after measured demand; room affinity already belongs to the Durable
  Object and must never depend on Modal process stickiness.
- Release live speech is limited to Arabic, German, English, Spanish, French
  and Japanese. Caption text coverage and Locale profile count are not a claim
  of full per-language conversational quality. Production TTS has four
  Languages and nine profiles; the other catalog Languages are captions-only.
- Voice identity is a selected synthesized style, not gender detection and not
  voice cloning.
- A `workers.dev` address and native Edge app-mode shortcut are sufficient. A
  custom domain, account system and app-store wrapper are later distribution work.
- The signed participant URL is deliberately replayable for up to 24 hours, but
  its creator can revoke it from the device-local host dashboard. Single-use
  participant invitations still require an account model.
- Cloud deployment requires local Wrangler and Modal authentication. Code and
  offline tests may be complete before those interactive account grants exist,
  but A8, A9 and A11 remain visibly unmet until their live receipts exist.

# Multilingual product handoff

Last live verification: **2026-08-14, 05:59 +07**. This is the authoritative
handoff for the multilingual expansion; historical bilingual receipts remain
historical evidence and do not silently become multilingual quality proof.

## Released state

| Item | Verified state |
|---|---|
| Branch / PR | `spoken-translation`; [PR #3](https://github.com/javin23863/lang/pull/3), open and clean at the time of the deployed runtime source |
| Deployed runtime source | `08392d818d23e486c50200b4f17cee498d5ccb25` — `fix: fail closed Japanese voice runtime` |
| Public Worker | `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev` — version `f9976551-31df-47e7-9816-3d4e0e85fc75`; deployment `09b15764-0806-481a-9142-484b47653ac6` |
| Modal compute | App `ap-BGN0rYSJePL3mDbezdmZOe`, version **v20**, tag `08392d8`, deployed 2026-08-14 05:54:25 +07; [Modal app](https://modal.com/apps/m2747076/main/deployed/spoken-translation-compute) |
| Modal ingress | `https://m2747076--spoken-translation-compute-web-ap-south.ap-south.modal.run` |
| Desktop shortcut | `C:\Users\MSI\Desktop\Live Translator.lnk` → `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --app=https://spoken-translation-room.spoken-translation-cloudflare.workers.dev` |

The Modal function is AP-routed (`routing_region="ap-south"`), but the actual
v20 model-load log reported `MODAL_REGION=us-east-2`. Do not describe this as
AP-only compute. The deployment has one L4 function, `max_containers=1`,
`min_containers=0`, a 60-second scale-down window and one persistent model
Volume. A post-probe container listing saw exactly one live container; no second
function or warm reserve was enabled.

## What is implemented

- One shared, data-first capability catalog drives browser, Worker, Modal, local
  adapter and tests. It exposes **100 M2M100 text Languages**, **84 free
  Whisper→M2M100 microphone candidates**, and **106 selectable BCP-47 Locale
  profiles**. Six exercised Languages (`ar`, `de`, `en`, `es`, `fr`, `ja`) are
  marked `Tested`; all other joinable routes are explicitly `Preview`.
- Voice output combines **6 included TTS Languages / 13 pinned profiles** with
  exact-language voices returned by each browser/device. Device voices remain
  local and are never sent as server profile IDs; wrong-language fallback is
  prohibited.
- Locale is explicitly distinct from a base Language. The catalog includes the
  requested Spanish regional profiles (`es-ES`, `es-MX`, `es-US`, `es-AR`,
  `es-CO`, `es-CL`, `es-PE`, `es-VE`, `es-DO`, `es-PR`); they map to base `es`
  and make no dialect-specific ASR/MT claim.
- One speaker ASR transcript fans out once to unique current listener base
  Languages (maximum three). Same-base Locale listeners share a translation;
  room/peer changes reconfigure routes without cross-room leakage.
- The production MT adapter is one revision-pinned M2M100 418M CTranslate2
  model (`facebook/m2m100_418M@55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636`,
  MIT), using explicit source token / target prefix semantics. The existing
  caption filter and partial/final dedup remain in place.
- The native HTML/CSS/JS PWA has a compact grouped native Locale selector,
  native/display names, RTL metadata, responsive 360 px layout, capability badges, room and
  connection state, a captions dock, settings/voice controls, dashboard and
  WhatsApp/native share flow. The Windows local adapter remains visibly
  captions-only by default and never downloads/converts models.
- Kokoro is enabled only for the seven checksum-pinned English/Spanish/French
  profiles. Japanese has documented upstream voice candidates but is **not
  release-enabled**: the actual v19 Japanese initialization reached an
  undeclared MeCab/fugashi dictionary dependency. v20 removes the Japanese
  release profiles and `misaki[ja]` lock input, builds voice pipelines lazily,
  and reports a specific unavailable reason. It never substitutes another
  language's voice.

## Public deployment receipts

Public `GET /health` returned `ok`. `GET /api/capabilities` returned
`Cache-Control: no-store`, revision `2026-08-14-m2m100-55c2e61-tts3`, and the
counts above. The `ja-JP` capability says Voice is unavailable because a
documented provider voice is not enabled for the release-tested runtime.

On v20, Modal logs recorded:

- Whisper `large-v3-turbo` loaded on CUDA/float16;
- M2M100 loaded on CUDA/`int8_float16`, revision `55c2e61bbf05`;
- production compute preload completed in **15.479 s**;
- Kokoro loaded on CUDA without a MeCab/fugashi error.

One real, public, participant-authorized `/tts` probe per enabled route returned
valid mono 24 kHz WAV:

| Target voice route | Result |
|---|---|
| Spanish (`es-ef-dora`) | 96,044 bytes, 48,000 frames, 50.047 s cold request |
| English (`en-us-af-heart`) | 115,244 bytes, 57,600 frames, 2.781 s after the cold request |
| French (`fr-ff-siwis`) | 140,444 bytes, 70,200 frames, 1.625 s after the cold request |
| Stream-preloaded Spanish retry | 96,044 bytes, 2.125 s |

Those are request-to-WAV timings, not speech-end-to-playing latency and not
human-audibility evidence. Earlier end-to-end warm receipt truth remains
**3/5 at or below 3 s, median 2.920 s**; previous scale-to-zero cold
speech-end-to-playing was roughly **25–26 s**. The new 50.047 s first TTS call
is a real v20 cold observation and must not be hidden behind the older figure.

An authenticated Japanese candidate `/tts` request returned **422** before it
could reach Modal. That is the intended fail-closed behavior. The public stream
load receipt is not a semantic translation-quality certificate: the strict,
seven-fixture `/mt-receipt` corpus remains authenticated behind the server-held
`MODAL_SHARED_SECRET`. This machine is not authorized to read or print it.

## Validation record

Local Windows gates at the deployed runtime source:

| Command family | Result |
|---|---|
| `wa-translator/windows`: catalog + M2M + fixtures + TTS acceptance unit suite | 20/20 passed |
| `wa-translator`: deployment, Modal and deployment-verifier suite | 29/29 passed after the verifier TDD repair |
| `wa-translator/windows`: `python test_room.py` | 19/19 passed |
| `wa-translator/cloudflare`: `npm run check` | TypeScript typecheck; 9 test files / 32 tests; Wrangler dry-run passed under local Node 24 |

The fresh Linux exact-runtime checkout was
`/tmp/lang-multilingual-tts3.PaLX76/repo`, detached at `08392d8`. It passed
20/20, 28/28 (before the verifier-only final test), and room 19/19 with a
minimal isolated Python 3.12 venv. Worker typecheck and 9/32 tests passed under
Node 20.20.2; Wrangler dry-run correctly refused because that host has no Node
22+. This is an environment ceiling, not a Node-22 source failure—the local
Node 24 gate passed. CodeRabbit/Coderabbit CLIs were absent on `sinbox`, so no
authenticated external CLI review exists. The code graph is absent; no design
claim was derived from a graph.

Static browser/UI receipts retained for this wave:

- `C:\Users\MSI\AppData\Local\Temp\room_check_360.png` — 360 px room view;
- `C:\Users\MSI\AppData\Local\Temp\room_check_rtl.png` — RTL room view.

They show the local adapter's honest captions-unavailable state, not cloud TTS
or a human-heard audio result.

## License and model decisions

- M2M100 418M is MIT and is the sole shipping MT model. The model/revision and
  primary source links are recorded in `wa-translator/MULTILINGUAL-SOURCES.md`.
- Kokoro artifacts are pinned under the catalog's stated Apache-2.0 decision.
  Enabled voice artifact bytes are SHA-256 checked. The source's documented
  thin-language and short-utterance caveats remain product limitations.
- NLLB-200 is not shipped because its official model card uses CC-BY-NC-4.0.
  MADLAD-400 is only a future research adapter; it is not measured or enabled.
- Japanese TTS stays disabled until one exact tokenizer/dictionary artifact,
  license notice, model compatibility receipt and native-speaker evaluation are
  approved. Do not treat the existence of Japanese Locale/caption support as a
  TTS quality claim.

## Open acceptance and roadmap

- **A8 — partial.** A live Modal process replacement during an observed natural
  WebRTC call, and an explicit Windows-host-off receipt, are still missing.
- **A11 — unmet.** Automation and valid WAVs do not prove a person audibly
  heard male/female output in the Codex in-app browser.
- The seven fixed M2M semantic fixtures require a controlled authorized run;
  no secret should be copied to the browser, repo or logs.
- Continue quality evaluation with native speakers per language/direction,
  including names, numbers, code switching, profanity and domain content.
- Add a separately licensed voice provider only after controlled language,
  artifact and audio evaluation; then expand the real-device/browser matrix.
- Native mobile/store distribution, accounts/history and database work remain
  out of scope until separately authorized.

## Resume, deploy and rollback

Run from `C:\Users\MSI\lang-repo`; do not force-push or merge PR #3 during this
wave. Re-run the local gates before any runtime change:

```powershell
Push-Location wa-translator\windows
..\..\.venv\Scripts\python.exe -m unittest -q test_language_catalog.py test_latency_acceptance.py test_m2m_catalog.py test_multilingual_fixtures.py
..\..\.venv\Scripts\python.exe test_room.py
Pop-Location
Push-Location wa-translator
..\.venv\Scripts\python.exe -m unittest -q test_deployment_config.py test_modal_app.py test_verify_multilingual_deployment.py
Pop-Location
Push-Location wa-translator\cloudflare
npm run check
Pop-Location
```

Deploy the same audited source only after those gates:

```powershell
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
.\.venv\Scripts\modal.exe deploy wa-translator\modal_app.py --tag <short-sha>
Push-Location wa-translator\cloudflare
npx wrangler deploy --message "<audited reason and short sha>"
Pop-Location
```

For a controlled rollback, first inspect history. Roll Worker to the prior
known version only if that is the intended emergency state; it predates the
Japanese fail-closed fix. Roll Modal to v19 only with the same caution: v19 is
known to fail Japanese TTS at the dictionary frontend.

```powershell
.\.venv\Scripts\modal.exe app history ap-BGN0rYSJePL3mDbezdmZOe --json
.\.venv\Scripts\modal.exe app rollback ap-BGN0rYSJePL3mDbezdmZOe v19 --strategy rolling
Push-Location wa-translator\cloudflare
npx wrangler deployments list --json
npx wrangler rollback e07062e4-f1c6-498e-8372-33b5c0eaa532 --name spoken-translation-room --message "controlled rollback" --yes
Pop-Location
```

To run the strict semantic verifier, an authorized operator must supply the
existing server secret through the process environment without printing it:

```powershell
Push-Location wa-translator
..\.venv\Scripts\python.exe verify_multilingual_deployment.py `
  --worker-url https://spoken-translation-room.spoken-translation-cloudflare.workers.dev `
  --modal-url https://m2747076--spoken-translation-compute-web-ap-south.ap-south.modal.run
Pop-Location
```

## Host/process custody

Do **not** stop, restart or mutate inherited room processes **7344, 9528 and
11452**. Use isolated ports/processes for diagnostics and clean only those you
start. The verified desktop shortcut must continue to target the public Worker
origin above.

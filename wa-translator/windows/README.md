# Local multilingual room adapter (Windows)

This is the local development adapter for the same browser room used in the
cloud beta. It shares [`../capabilities.json`](../capabilities.json): **100
M2M100 text Languages**, **84 free microphone-language candidates**, and **106
selectable regional Locale profiles**. Arabic, German, English, Spanish,
French and Japanese are the exercised `Tested` tier; the remaining routes are
marked `Preview`. A Locale maps to one base Language; every Spanish regional
Locale maps to `es` and makes no dialect-specific ASR/MT claim.

The local adapter validates the same Locale and multi-target room protocol, but
deliberately advertises no server TTS profiles. The shared client can still use
an exact-language voice installed on the browser/device; it never substitutes
a neighboring language. Production also offers thirteen pinned included
profiles for English, Spanish, French, Hindi, Italian, and Brazilian Portuguese
on the single Modal L4.

## Install the desktop application

From the repository root, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wa-translator\windows\persistent_host.ps1 -Action Install
```

This creates one `Live Translator` Desktop shortcut that opens the permanent
Cloudflare application in Edge app mode. It also removes the retired Windows
login task and its old Open/Start/Stop shortcuts. The installed shortcut does
not depend on Python, this repository, a localhost server, or the Codex browser.
Run the installer again at any time to repair the shortcut safely.

## Run it

```powershell
cd wa-translator\windows
..\..\.venv\Scripts\python.exe run_room.py          # private tunnel link
..\..\.venv\Scripts\python.exe run_room.py --local  # localhost only
```

The server creates a private bearer room. Open the link, use Share/WhatsApp if
desired, choose your speaking Locale, and join. A room accepts at most four
people; one transcription fans out once to the unique listener base Languages
(maximum three targets). The local URL and quick tunnel are development tools;
they are never installed or started by the Desktop application. The permanent
public dashboard and Desktop shortcut target the Cloudflare origin, not this
process.

Do not start this adapter on any inherited room port/process. It is
UI/protocol-only by default and explicitly reports that local caption compute
is unavailable; it never downloads or converts Whisper/M2M100 on Windows. For
an audited local read of an already provisioned cache only, set
`LANG_ROOM_LOCAL_MODEL_LOAD=1`. That advanced path is not a production model
receipt. Choose a unique test port for every isolated UI check.

## What runs where

| File | Job |
|---|---|
| `translation_server.py` | local room, WebRTC signalling, Locale validation, caption fan-out and captions-only capability response |
| `language_catalog.py` | shared catalog adapter and fail-closed lookup/search helpers |
| `mt_ct2.py` | revision-pinned M2M100 418M CTranslate2 adapter; source tokenized once, target-prefixed batch fanout |
| `asr_whisper.py` | faster-whisper `large-v3-turbo`, explicit source base Language |
| `static/index.html` | professional local host dashboard |
| `static/room.html` | responsive room UI, compact native Locale picker with native-first labels, RTL, caption dock and voice capability state |
| `browser_check.py` | isolated browser WebRTC/UI lifecycle check, including host dashboard, 360 px, native Locale labels and RTL assertions |
| `test_room.py` | private links, isolation, room cap, multi-target dedupe, protocol and capability endpoint checks |
| `test_language_catalog.py` | catalog counts, Spanish mappings, RTL, capability truth and search |
| `test_m2m_catalog.py` | public M2M token/fanout/passthrough/bounds contract with fakes |

## Local checks

No model download or GPU is needed for the contract checks:

```powershell
cd wa-translator\windows
$py = "..\..\.venv\Scripts\python.exe"
& $py -m unittest -v test_language_catalog.py test_m2m_catalog.py test_multilingual_fixtures.py
& $py test_room.py
```

`browser_check.py` needs a separately started isolated local server. It proves
WebRTC, captions-only default, compact exact-profile picker behavior, native
Locale labels, sharing, host dashboard, 360 px and RTL layout. Its simulated
audio lifecycle is not a human-audible acceptance
receipt and does not claim cloud TTS is locally available.

## Model and quality boundary

The M2M100 artifacts are revision-pinned and hash-checked when a
pre-provisioned local cache is actually used. The user-authorized production
model download, conversion and performance work belongs on Modal's AP-routed
L4; Windows never materializes that lane. Read
[`../MULTILINGUAL-SOURCES.md`](../MULTILINGUAL-SOURCES.md) for the official
coverage, license, artifact pins and quality limitations.

The historical bilingual/OPUS-MT benchmarks and old CPU-TTS receipts remain in
Git as past evidence only. They do not validate this multilingual M2M100
release, its non-English pairs, or human-audible playback.

## Known limits

- Quick-tunnel URLs change on restart; the production Worker has the stable
  `workers.dev` origin and its own room lifecycle.
- The local adapter has no production TURN relay or cloud TTS; test those on
  the deployed Worker/Modal path.
- The default local runtime has no caption model either; its capability overlay
  says so instead of presenting a non-running model as enabled.
- A catalog entry is not a quality guarantee. Text coverage, live-speech
  coverage and TTS coverage are separately declared and unsupported choices
  fail closed.
- Partials can change before the final; spoken output is final-only in the
  production path to protect speech naturalness and the ASR feedback guard.

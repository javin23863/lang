# Broad voice and language source record

Research date: 2026-08-14
Status: primary-source research only. This file does not change the product,
enable a provider, download a model, or certify quality, latency, commercial
rights, or human-audible playback.

Operator decision: free-first. No paid speech provider is being added. The
implementation uses the 84-code Whisper→M2M100 intersection, 106 existing
regional Locale profiles, thirteen included pinned cloud voices, and
exact-language voices returned by each user's browser/device. Paid-provider
sections below remain comparative research only.

## Decision in one page

The product can honestly offer a much broader *catalog* now, but it must stop
using one number for three different things:

| What is counted | Current source-level result | Honest product wording |
|---|---:|---|
| Whisper `large-v3-turbo` ASR language tokens | **100** | "100 model-recognized language candidates" |
| Whisper -> M2M100 microphone-caption paths after the only clear code normalization (`jw -> jv`) | **84** | "84 model-pair caption candidates" |
| M2M100 target text languages | **100** | "100 caption/translation target languages" |
| Release-tested live speaking routes | separate, much smaller allowlist | "verified live speech" |
| Cloud TTS entries | provider-, region-, model-, plan-, and account-dependent | "available voice profiles" |

`large-v3-turbo` has **100**, not 99, tokenizer language tokens. That makes
100 *model candidates* discoverable, but it does **not** make 100 languages
production-supported speech recognition or spoken translation. OpenAI's own
model card says non-English training represents 98 languages, reports strong
ASR results in only about 10 languages, and warns that accuracy differs by
language, accent, and dialect. The turbo release additionally calls out larger
degradation for Thai and Cantonese. [OpenAI model card](https://github.com/openai/whisper/blob/main/model-card.md) and [turbo release note](https://github.com/openai/whisper/discussions/2363)

For paid, broad TTS, use **Azure Speech as the first provider to evaluate**.
It is the only investigated managed catalog whose official source table has
more than 100 selectable language/locale entries. That is **not** evidence of
100 distinct base languages: the table currently has 154 language/locale labels
but 82 primary BCP-47 subtags. Its live regional Voice List response—not the
documentation count—is the only availability truth for a deployment. See
[Azure language and voice support](https://learn.microsoft.com/azure/ai-services/speech-service/language-support) and [the underlying TTS source table](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/includes/language-support/tts.md).

If the product requirement is literally **100 distinct professionally supported
spoken languages**, none of the commercial and open-weight options researched
below proves that requirement today. The smallest honest plan is therefore:

1. expose the broad text/caption catalog with native-language labels and clear
   readiness states;
2. keep a separately measured, native-speaker-tested live-speech tier; and
3. add one cloud TTS provider with runtime capability discovery, exact locale
   matching, and captions-only failure behavior.

Do not claim "100 voices" from "100 languages," or "100 languages" from a
list of regional variants. A language is `Spanish`; `es-ES` and `es-MX` are
locale variants; each selectable synthesis identity within one locale is a
voice.

## 1. Exact model coverage

### Whisper `large-v3-turbo`

The official `openai/whisper-large-v3-turbo` repository resolves at
`41f01f3fe87f28c78e2fbf8b568835947dd65ed9` as observed on the research date.
Its configuration has `vocab_size = 51866`; the official Whisper source derives
the number of model languages as
`n_vocab - 51765 - int(is_multilingual)`, which is 100 for this vocabulary.
The repository's tokenizer configuration lists 100 language specials, ending
in `<|yue|>`. [Pinned model configuration](https://huggingface.co/openai/whisper-large-v3-turbo/blob/41f01f3fe87f28c78e2fbf8b568835947dd65ed9/config.json), [pinned tokenizer configuration](https://huggingface.co/openai/whisper-large-v3-turbo/blob/41f01f3fe87f28c78e2fbf8b568835947dd65ed9/tokenizer_config.json), and [Whisper model source](https://github.com/openai/whisper/blob/main/whisper/model.py)

The exact ordered token-code set is:

```text
en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs
ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk
br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu
am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su yue
```

This establishes tokenizer eligibility only. It is appropriate to expose these
codes as a searchable **model-candidate** ASR catalog after the runtime asserts
the loaded model's vocabulary. It is not appropriate to label all 100 as
"professional," "verified," or "live spoken" before per-language evidence.

Whisper's built-in `translate` task is speech-to-English, not general
many-to-many translation. The broad design must use `transcribe` in the spoken
language, then send text to a separate MT layer. [OpenAI Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md)

### M2M100 418M

The official Meta artifact `facebook/m2m100_418M` is MIT-licensed at
`55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636`. Its card states 100 languages and
9,900 ordered non-self directions. [Pinned Meta model card](https://huggingface.co/facebook/m2m100_418M/blob/55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636/README.md)

```text
af am ar ast az ba be bg bn br bs ca ceb cs cy da de el en es et fa ff fi fr
fy ga gd gl gu ha he hi hr ht hu hy id ig ilo is it ja jv ka kk km kn ko lb
lg ln lo lt lv mg mk ml mn mr ms my ne nl no ns oc or pa pl ps pt ro ru sd
si sk sl so sq sr ss su sv sw ta th tl tn tr uk ur uz vi wo xh yi yo zh zu
```

Comparing the two official code lists gives:

| Derived relationship | Count | Notes |
|---|---:|---|
| Literal code overlap | 83 | Exact string match only. |
| Semantic overlap after explicit `jw -> jv` Javanese normalization | 84 | This is the only normalization justified directly by the two lists. |
| Whisper-only codes | 17 | `la mi te eu sn tg fo tk nn mt sa bo as tt haw jw yue` |
| M2M100-only codes | 17 | `ast ceb ff fy ga gd ig ilo jv lg ns or ss tn wo xh zu` |

This means the present Whisper+M2M stack can legitimately show all 100 M2M
*text targets*, but only 84 model-pair *microphone-source candidates* once the
Javanese code mapping is made explicit. The remaining code differences are
not permission to silently substitute a related language or locale.

## 2. Cloud TTS: exact counts versus live capability

All static counts below are documentation snapshots from 2026-08-14. They are
useful for product selection, but must not be hard-coded into the room UI:
availability changes by provider region, model, account entitlement, and
preview status.

| Provider | Official static/source snapshot | Live source of truth | Does it substantiate 100 distinct base TTS languages? |
|---|---|---|---|
| Azure Speech | 767 distinct listed voice IDs; 154 language/locale labels; 82 primary subtags in the complete documentation table. Its multilingual-voice matrix has 137 listed multilingual voices for 94 locale entries / 77 primary subtags. | Regional [Voice List REST API](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices). | **No** for 100 distinct base languages; **yes** for 100+ language/locale profiles if worded exactly that way. |
| Google Cloud TTS | Current Supported Voices table: 2,032 distinct listed voice names, 61 locale codes, 53 primary subtags. Google separately markets 75+ languages and variants. | Authenticated [`voices:list`](https://cloud.google.com/text-to-speech/docs/reference/rest/v1/voices/list). | **No**. |
| Amazon Polly | Available Voices table: 42 language/variant rows, 26 primary subtags, and 109 distinct documented name IDs after deduplicating repeated bilingual names. The engine-specific docs say 60 Standard voices/29 variants and 43 Generative voices; do not add those counts because identities overlap. | IAM-authorized [`DescribeVoices`](https://docs.aws.amazon.com/polly/latest/APIReference/API_DescribeVoices.html) in the chosen AWS Region. | **No**. |
| ElevenLabs | Eleven v3's published list has **74** languages; Multilingual v2 has 29 and Flash v2.5 has 32. | Account-scoped [`GET /v2/voices`](https://elevenlabs.io/docs/api-reference/voices/search), whose `total_count` is explicitly a live snapshot. | **No**. |

The static-table counts above were deliberately calculated as separate
language/locale/voice measures. They are not benchmark results or guarantees
that every voice is available in every production region.

### Azure AI Speech — recommended first evaluation

- **Coverage.** Azure's complete TTS table is the broadest first-party
  catalog found here. It reports language-and-locale profiles and individual
  voice IDs, not a promise of 154 distinct base languages. The runtime must
  query `GET https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list`
  using the chosen resource's credentials and retain only exact locale/voice
  records returned for that region. [Azure REST reference](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech)
- **Commercial and licensing posture.** This is a managed Azure service, not
  an open-weight license. The relevant product terms must be accepted by the
  account owner. For a paid app, use a paid Azure Speech subscription; custom
  and personal voice features have separate limited-access and voice-talent
  obligations and are unnecessary for this product. [Microsoft Product Terms](https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/OL) and [Azure custom voice overview](https://learn.microsoft.com/azure/ai-services/speech-service/custom-neural-voice)
- **Price/free tier.** The current F0 tier lists 0.5 million neural-TTS
  characters per month. S0 pricing is per character and varies with selected
  region/agreement, so this record intentionally does not invent a universal
  dollar rate. [Azure Speech pricing](https://azure.microsoft.com/pricing/details/speech/)
- **Latency/streaming.** The REST API returns synthesis audio; the SDK exposes
  first-byte, finish, network, and service-latency measurements. Azure does
  not publish one end-to-end latency number that would clear a live-room gate.
  Measure it from the deployed Modal/Worker path. [Latency guidance](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-lower-speech-synthesis-latency)
- **Authentication and data handling.** REST accepts an Azure resource key or
  Bearer token; production should keep it server-side and prefer managed
  identity/Entra where the host supports it. Speech resources are regional;
  Microsoft states that data is processed/stored in the resource's region, and
  that prebuilt neural-voice text/audio are not stored in Microsoft logs.
  [Authentication](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#authentication), [regions](https://learn.microsoft.com/azure/ai-services/speech-service/regions), and [TTS data privacy](https://learn.microsoft.com/azure/foundry/responsible-ai/speech-service/text-to-speech/data-privacy-security)
- **Fit.** A narrow server-side adapter is a clean fit: Worker preserves room
  authorization and talks only to Modal; Modal owns the Azure credential,
  locale-to-voice query, audio synthesis, timeout, and metrics. Do not put an
  Azure key in browser JavaScript.

### Google Cloud Text-to-Speech — capable, but not 100 base languages

- **Coverage.** The current official table has the counts shown above; its
  product material describes "75+ languages and variants." Treat the
  authenticated Voice List response as the deployment catalog. [Supported
  voices and languages](https://cloud.google.com/text-to-speech/docs/voices)
- **Commercial and pricing.** It is a billed Google Cloud service subject to
  Cloud terms, not a reusable voice-model license. Billing is required. Current
  published prices/free monthly allowance include Standard $4/M after 4M,
  Neural2 $16/M after 1M, and Chirp 3 HD $30/M after 1M characters; Gemini TTS
  is separately token-priced with no listed free allowance. Recheck at purchase
  because price and model availability can change. [Pricing](https://cloud.google.com/text-to-speech/pricing)
- **Latency/streaming.** Chirp 3 HD supports streaming synthesis; the service
  documents bidirectional streaming rather than a universal latency guarantee.
  [Chirp 3 HD guide](https://cloud.google.com/text-to-speech/docs/chirp3-hd)
- **Authentication and data location.** Use a service account/ADC or OAuth,
  not browser credentials. Google documents global, US, EU, and selected
  regional endpoints; US/EU endpoints keep data at rest and in use inside that
  boundary. [Authentication](https://cloud.google.com/text-to-speech/docs/authentication) and [regional endpoints](https://cloud.google.com/text-to-speech/docs/endpoints)
- **Fit.** Prefer a Modal-side service-account adapter. It avoids distributing
  OAuth material to a Worker/browser, while preserving an auditable provider
  boundary.

### Amazon Polly — useful fallback, clearly below the language target

- **Coverage.** The official language table enumerates 42 language variants.
  Do not use the marketing headline "100+ voices" as a language count. Query
  `DescribeVoices` with the actual region and selected engine before exposing a
  choice. [Available voices](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html) and [DescribeVoices](https://docs.aws.amazon.com/polly/latest/APIReference/API_DescribeVoices.html)
- **Commercial and pricing.** Polly is a paid AWS service under AWS terms. The
  published rates are Standard $4/M, Neural $16/M, Long-Form $100/M and
  Generative $30/M characters. The first-12-month published quotas are 5M,
  1M, 0.5M, and 0.1M characters/month respectively, subject to the current AWS
  Free Tier enrollment. Generated audio may be cached/replayed without an
  extra Polly charge. [Pricing](https://aws.amazon.com/polly/pricing/)
- **Latency/streaming.** `SynthesizeSpeech` returns streaming audio bytes;
  bidirectional HTTP/2 input/output streaming is Generative-only and needs an
  SDK. No fixed live-room latency is promised. [AWS streaming comparison](https://docs.aws.amazon.com/polly/latest/dg/bidirectional-streaming-choosing.html)
- **Authentication/data.** It uses AWS IAM and Signature Version 4, with a
  region-specific catalog. It is feasible from a server, but a Modal-side AWS
  SDK/signer is simpler than implementing signing at the Worker edge.

### ElevenLabs — strong experience option, not a 100-language answer

- **Coverage.** ElevenLabs' own help center enumerates 74 Eleven v3 languages;
  its model page states v2=29 and Flash v2.5=32. A large voice library does not
  raise that language count, and the docs warn that matching a voice's accent
  to the target matters for natural results. [74-language list](https://help.elevenlabs.io/hc/en-us/articles/13313366263441-What-languages-do-you-support) and [model matrix](https://elevenlabs.io/docs/overview/models)
- **Commercial and pricing.** Generated audio can be used commercially only on
  a paid plan; the free tier is not an app-commercialization path. Current API
  pricing lists Flash/Turbo at $0.05 per 1K characters and Multilingual v2/v3
  at $0.10 per 1K, with displayed included usage varying by plan. Recheck the
  account's current plan and invoice before launch. [Commercial-use guidance](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform) and [API pricing](https://elevenlabs.io/pricing/api)
- **Latency/streaming.** HTTP audio streaming is available; Flash v2.5's
  approximately 75 ms claim excludes application and network latency. The
  project must measure full caption-to-audio first byte. [Models](https://elevenlabs.io/docs/overview/models) and [streaming guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming)
- **Authentication/data.** Use a server-held `xi-api-key` only. Standard data
  storage is US; isolated EU, India, and Singapore environments plus zero
  retention are Enterprise features, and regional storage is not automatically
  regional processing. [API authentication](https://elevenlabs.io/docs/api-reference/authentication) and [data residency](https://elevenlabs.io/docs/overview/administration/data-residency)
- **Fit.** It is the simplest HTTP-stream proxy of the options above, but does
  not satisfy a truthful 100+ base-language TTS promise.

## 3. Open-weight candidates are not the commercial 100-language shortcut

| Candidate | Official coverage/license | Decision |
|---|---|---|
| Meta MMS TTS | 1,107 languages; **CC-BY-NC-4.0** | Reject for a paid app without separately obtained commercial rights. [Model card](https://huggingface.co/facebook/mms-tts) |
| Current Kokoro 82M | 8 language groups / 54 voices; Apache-2.0 | Commercially plausible only for its documented narrow coverage; it cannot solve a 100-language voice requirement. [Model card](https://huggingface.co/hexgrad/Kokoro-82M) |
| Coqui XTTS-v2 | 16 documented languages; Coqui Public Model License says non-commercial use | Reject for ordinary paid shipping without a separate license; also far below the language target. [Model card](https://huggingface.co/coqui/XTTS-v2) and [license text](https://huggingface.co/coqui/XTTS-v2/blob/main/LICENSE.txt) |

There is therefore no ready, commercially-cleared, open-weight TTS choice in
this set that converts the existing Modal deployment into 100 verified spoken
languages. Do not incur a second model-serving project merely to recreate a
smaller provider catalog.

## 4. Smallest honest product plan

### Product states

Keep the shared catalog, but show these independently and never collapse them
into a single "supported languages" count:

1. `MODEL_CAPTION_CANDIDATE` — exact Whisper/M2M mapping exists, but no
   language-direction quality and latency acceptance receipt.
2. `CAPTIONS_READY` — ASR and both required text directions passed the defined
   fixtures; no TTS profile is available.
3. `TTS_CANDIDATE` — the active provider returned an exact target locale plus
   voice ID; it has not yet cleared voice-quality and full-path latency tests.
4. `SPOKEN_READY` — exact ASR, MT, provider voice, audio output, and
   human-observable browser acceptance passed.
5. `UNAVAILABLE` — missing model mapping, provider account/region entitlement,
   expired capability manifest, or failed provider request. Show captions if
   available; do not silently choose a neighboring locale or voice.

The picker should search both the English and native language name, show the
native name first when appropriate, and use a compact scrollable/virtualized
list. Every row should tell the user whether it is captions-only, a
model-candidate, a verified route, or has an available voice. This avoids a
huge unscrollable menu and does not require the user to read English to pick
their own language.

### Implementable now, with no Azure credential

Do **not** attempt to fabricate a wider voice list from documentation. The
current Cloudflare Worker + Modal design already has authenticated Modal
[`/capabilities`, `/health`, and `/tts` routes](modal_app.py), with `/tts`
refusing any `voice_profile` absent from its explicit `VOICE_ROUTES` allowlist.
The smallest immediate product change is to make the Worker relay that same
capability data to the room UI and derive three separate picker sections from
it:

1. all 100 M2M text targets, with native and English labels, as
   captions/translation choices;
2. only the explicit release-tested source routes as live microphone choices;
   and
3. only returned `voice_profiles` as speech choices. If a selected target has
   no returned profile, display **Captions only -- no verified voice** and do
   not send a TTS request.

This needs no cloud-TTS account, no browser-held secret, and no expanded
Kokoro claim. It makes the existing fail-closed Modal allowlist visible rather
than presenting a short voice picker as if it were the entire language catalog.
It also fixes the language-selection usability problem: one compact,
scrollable, native-name searchable language catalog can be broad even while
the speech list stays short and truthful. The immediate honest ceiling is
therefore **100 text targets, 84 theoretical Whisper-to-M2M source candidates,
and only the already release-tested/local voice routes as spoken output**. The
last category must retain its current much-smaller count until actual testing
expands it.

No credentials can lift that 84-source ceiling: it comes from the current
Whisper ∩ M2M100 model pairing, not TTS. To claim **more than 100 live spoken
languages**, replace or supplement both sides of that pair with an ASR model
and MT model whose explicit normalized source-language intersection exceeds
100; add a commercially cleared TTS catalog that has more than 100 **distinct
base-language** output entries in the selected production regions; query it
with a server-held account credential; and independently pass per-language
ASR, translation, voice, latency, and real browser-listening acceptance. Azure
credentials alone can broaden locale/voice profiles, but its published table
does not prove 100 distinct base-language outputs and cannot turn the present
84 model-pair candidates into 100 live microphone languages.

### Azure's end-to-end catalog: exact snapshot and safe intersection

The following figures are a reproducible source snapshot taken on 2026-08-14,
not a promise that every entry is enabled in every account or region. They
were derived from Microsoft's two machine-readable Speech tables and the
public Translator `Languages` response:

| Azure surface | Exact source-level count | Source of truth / interpretation |
|---|---:|---|
| Speech-to-text documented locales | 148 BCP-47 locale strings; 81 primary subtags | The STT table is a catalog for multiple STT features. It does **not** establish that all 148 are accepted by the application's real-time stream, equally accurate, or enabled in a chosen region. [STT table](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/includes/language-support/stt.md) |
| Text Translation | 138 returned translation codes; 130 primary subtags | The unauthenticated live [`Languages?scope=translation`](https://api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation) response. Its observed ETag was `"yvTK5T7oMiAA6gtEyL+FSboqN5hrwTnUKkcUd0/wN10="`; the list may change. [API reference](https://learn.microsoft.com/azure/ai-services/translator/language-support) |
| Text-to-speech documentation | 154 BCP-47 locale strings; 82 primary subtags; 767 distinct listed voice IDs | Includes listed preview/HD entries; it is not the deployment entitlement. Query the resource's Voice List response before offering a choice. [TTS table](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/includes/language-support/tts.md) and [Voice List REST API](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices) |

Using only literal BCP-47 strings first, `STT ∩ TTS` contains **141** locale
strings. Of those, **139** have a Translator-supported *primary* subtag; the
two exceptions are `jv-ID` and `wuu-CN`. Literal three-way equality is only
**3** codes — `es-MX`, `fr-CA`, and `pt-PT` — because Translator normally
uses a language or language-plus-script code (`en`, `zh-Hans`) while Speech
uses a full recognition/synthesis locale (`en-US`, `zh-CN`). That result must
not be used as the product's language count.

The widest mechanical comparison that remains honest is only primary-subtag
normalization. It yields **78** potential base-language paths:

```text
af am ar as az bg bn bs ca cs cy da de el en es et eu fa fi fil fr ga gl gu
he hi hr hu hy id is it ja ka kk km kn ko lo lt lv mk ml mn mr ms mt my nb ne
nl or pa pl ps pt ro ru si sk sl so sq sr sv sw ta te th tr uk ur uz vi yue
zh zu
```

This is a selection-planning upper bound, not a certified Azure mapping. A
primary-subtag comparison can erase meaningful script or locale differences.
There is no official Azure endpoint providing a canonical
`Translator code -> STT locale -> TTS voice` crosswalk. The runtime manifest
must therefore keep all four typed values:
`translator_code`, `stt_locale`, `tts_locale`, and `voice_id`; it may publish
a tuple only after an explicit product mapping and an account/region Voice
List check. Never use primary-subtag equality to quietly turn `zh-Hans` into a
specific Mandarin voice, or to substitute a regional voice.

### Exact Azure resource request and integration boundary

For core standard Speech-to-text, Translator Text, and prebuilt Text-to-speech,
**separate Azure resources are not required**. Microsoft documents its Foundry
multi-service resource as `kind=AIServices`, with Speech and Translator among
the services accessed from one endpoint/key. Its current CLI example uses
`--kind AIServices --sku S0`. [Multi-service resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource), [Azure authentication](https://learn.microsoft.com/azure/ai-services/authentication), and [Translator resource types](https://learn.microsoft.com/azure/ai-services/translator/create-translator-resource)

The smallest production request to the account owner is:

```text
Create one Azure Foundry / Azure AI multi-service resource
  resource kind: AIServices
  SKU: S0 (pay-as-you-go)
  initial region: centralindia, unless a data-residency owner selects another
                  Azure Speech-supported region
  resource name: operator-chosen unique name, for example spoken-translation-azure-prod
  capabilities: standard real-time Speech STT, Translator Text, prebuilt neural TTS
  no custom/personal/professional voice or custom speech requested

Provide to the deployment operator, through a secure channel:
  AZURE_AI_KEY=<Key 1 or Key 2 from Keys and Endpoint>       # secret
  AZURE_AI_REGION=centralindia                               # configuration, not secret
  AZURE_AI_ENDPOINT=https://<resource>.cognitiveservices.azure.com/  # configuration, not secret
```

`centralindia` is an implementation recommendation, not a data-residency
claim: the current Modal function is routed as `ap-south`, and Microsoft's
region table lists Central India for core real-time transcription and neural
TTS. It is therefore a reasonable first path to measure. It must be replaced
if the owner selects a different permitted processing geography, and only a
real end-to-end measurement can establish latency. Speech keys are
region-scoped, and Microsoft says Speech data is processed/stored in the
resource's region; `southindia` is explicitly unsupported for Speech
processing through `AIServices`. [Speech regions](https://learn.microsoft.com/azure/ai-services/speech-service/regions)

The existing Modal secret named `spoken-translation-modal` is the narrowest
secret location for `AZURE_AI_KEY`; do not place it in browser JavaScript or
the Cloudflare Worker. `AZURE_AI_REGION` and `AZURE_AI_ENDPOINT` can be
ordinary server configuration, but keeping all three in that Modal secret is
also acceptable if the deployment convention requires it. The Worker should
continue to enforce room authorization and forward only an approved request;
Modal should own Azure calls, timeouts, metrics, and the versioned capability
manifest. This uses the current Worker + Modal boundary rather than introducing
a second proxy service. [Current Modal boundary](modal_app.py)

With the shared multi-service key, call Speech directly through its regional
service endpoints and use `Ocp-Apim-Subscription-Key`:

```text
STT:       https://centralindia.stt.speech.microsoft.com/
           speech/recognition/conversation/cognitiveservices/v1?language=<stt_locale>&format=detailed
TTS list:  https://centralindia.tts.speech.microsoft.com/cognitiveservices/voices/list
TTS:       https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1
Translator:https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=<translator_code>
```

Translator requires `Ocp-Apim-Subscription-Region: centralindia` in addition
to `Ocp-Apim-Subscription-Key` when that key belongs to a multi-service
resource. Speech supports the key header directly; an STS bearer token is
endpoint-scoped and expires after 10 minutes, so the direct key path is the
smallest first integration. [Speech STT quickstart](https://learn.microsoft.com/azure/ai-services/speech-service/get-started-speech-to-text), [Speech TTS REST](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech), [Translator authentication](https://learn.microsoft.com/azure/ai-services/authentication), and [Translator Text API](https://learn.microsoft.com/rest/api/translator/translator/translate?view=rest-translator-v3.0)

The first Modal-side action after credentials are supplied must be a bounded
provider discovery receipt: call the TTS Voice List in the chosen region, save
only its returned exact locale/voice pairs with a timestamp and provider
version, then join those records to an explicit Translator/STT mapping. A
missing or expired manifest is `UNAVAILABLE`, not a reason to guess a nearby
voice. The subsequent test gate remains per-route ASR, MT, TTS, latency, and
human-audible in-app-browser acceptance.

### F0 is an experiment, not the one-key production setup

Do not assume that the free quotas for separate Speech and Translator resources
combine inside an `AIServices` resource. Microsoft's current multi-service
creation example is S0, and Translator documents that multi-service
subscription limits are the S1 limits. The source record therefore treats
the **one-key S0 resource above as the production request**. [Multi-service
resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource) and [Translator limits](https://learn.microsoft.com/azure/ai-services/translator/service-limits)

If the owner wants a no-cost, non-production feasibility experiment instead,
request two **separate** F0 resources and two keys:

| Separate F0 resource | Published free allowance / relevant limit | Required configuration |
|---|---|---|
| Azure Speech (`SpeechServices`) | 5 audio hours/month for standard/custom real-time STT (shared); 0.5 million neural-TTS characters/month. F0 does not support batch transcription. | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Azure Translator (`TextTranslation`) | 2 million standard-translation characters/month; F0 throughput is 2 million characters/hour, with a 50,000-character Translate request maximum. | `AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION` for a regional resource (or use the documented global single-service endpoint) |

F0 proves credentials, catalog discovery, and a small controlled route set;
it is not capacity or commercial-acceptance proof for a live room. The
published Speech and Translator figures are available in [Speech pricing](https://azure.microsoft.com/pricing/details/speech/), [Speech quotas](https://learn.microsoft.com/azure/ai-services/speech-service/speech-services-quotas-and-limits), [Translator pricing](https://azure.microsoft.com/pricing/details/cognitive-services/translator/), and [Translator limits](https://learn.microsoft.com/azure/ai-services/translator/service-limits).

### One-provider rollout: Azure first

1. Obtain the one Azure `AIServices` **S0** resource and server-only key/region
   above. Do not route the key to a client.
2. On controlled startup and on a bounded refresh interval, request the
   regional Voice List API. Build a versioned manifest of only the returned
   `{provider, region, model/type, language, locale, voice_id, gender/style}`
   records. Expire it rather than assuming an old voice still exists.
3. Map a TTS option only when its explicit locale and script are appropriate to
   the translated target. A `zh` text target must not quietly become a
   different Sinitic locale; a regional profile is not evidence of dialect
   quality.
4. The browser asks the existing Worker for a permitted exact profile. Worker
   retains room authorization; Modal performs provider calls and streams audio
   back. On a lookup/synthesis/timeout failure, restore natural audio and keep
   captions visible.
5. Add native-speaker fixtures, short-turn tests, names/numbers/code-switching
   tests, cold/warm first-byte latency, and real in-app-browser listening proof
   before moving a language from candidate to `SPOKEN_READY`.

This is intentionally one provider, one capability manifest, and one truthful
state machine. It does not add voice cloning, a second cloud, or an
unlicensed model merely to inflate a catalog count.

## 5. Explicit blockers before implementation or a new public claim

- **Credential/account blocker:** no Azure `AIServices` S0 subscription
  resource, selected region, resource endpoint, or server-only key was
  supplied to this research task. Without one, the required regional Voice
  List query cannot establish the actual entitled voices or price.
- **Product-language blocker:** an owner must choose whether the public promise
  means "100+ language and locale profiles" or "100+ distinct base spoken
  languages." The first is feasible with Azure wording; the second is not
  substantiated by these sources.
- **Quality blocker:** no provider/model benchmark, native-speaker review,
  paid-account voice inventory, or human-audible in-app-browser test was run.
  This record authorizes none of those claims.
- **Legal/procurement blocker:** managed-service terms, data-processing
  agreement, permitted geography, retention, and commercial plan must be
  accepted by the account owner before shipping. This is technical source
  research, not legal advice.

## Primary sources

- OpenAI: [Whisper tokenizer](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py), [model source](https://github.com/openai/whisper/blob/main/whisper/model.py), [model card](https://github.com/openai/whisper/blob/main/model-card.md), and [turbo release](https://github.com/openai/whisper/discussions/2363).
- Meta: [M2M100 418M model card](https://huggingface.co/facebook/m2m100_418M).
- Microsoft: [STT/TTS support tables](https://learn.microsoft.com/azure/ai-services/speech-service/language-support), [Translator Languages API](https://learn.microsoft.com/rest/api/translator/translator/languages?view=rest-translator-v3.0), [multi-service resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource), [authentication](https://learn.microsoft.com/azure/ai-services/authentication), [multilingual voice matrix](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/includes/language-support/multilingual-voices.md), [TTS REST reference](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech), [Speech pricing](https://azure.microsoft.com/pricing/details/speech/), [Translator pricing](https://azure.microsoft.com/pricing/details/cognitive-services/translator/), [regions](https://learn.microsoft.com/azure/ai-services/speech-service/regions), and [privacy](https://learn.microsoft.com/azure/foundry/responsible-ai/speech-service/text-to-speech/data-privacy-security).
- Google: [supported voices](https://cloud.google.com/text-to-speech/docs/voices), [Voice List API](https://cloud.google.com/text-to-speech/docs/reference/rest/v1/voices/list), [pricing](https://cloud.google.com/text-to-speech/pricing), [authentication](https://cloud.google.com/text-to-speech/docs/authentication), and [regional endpoints](https://cloud.google.com/text-to-speech/docs/endpoints).
- AWS: [available voices](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html), [DescribeVoices](https://docs.aws.amazon.com/polly/latest/APIReference/API_DescribeVoices.html), [streaming comparison](https://docs.aws.amazon.com/polly/latest/dg/bidirectional-streaming-choosing.html), and [pricing](https://aws.amazon.com/polly/pricing/).
- ElevenLabs: [models](https://elevenlabs.io/docs/overview/models), [language list](https://help.elevenlabs.io/hc/en-us/articles/13313366263441-What-languages-do-you-support), [voice list endpoint](https://elevenlabs.io/docs/api-reference/voices/search), [authentication](https://elevenlabs.io/docs/api-reference/authentication), [commercial-use guidance](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform), [pricing](https://elevenlabs.io/pricing/api), and [data residency](https://elevenlabs.io/docs/overview/administration/data-residency).
- Open-weight candidates: [Meta MMS TTS](https://huggingface.co/facebook/mms-tts), [Kokoro 82M](https://huggingface.co/hexgrad/Kokoro-82M), and [Coqui XTTS-v2](https://huggingface.co/coqui/XTTS-v2).

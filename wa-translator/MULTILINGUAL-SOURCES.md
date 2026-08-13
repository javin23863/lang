# Multilingual expansion: primary-source decision record

Research date: 2026-08-14
Source policy: official model repositories, official runtime documentation and
source, and author papers only.
Status: architecture research, not implementation or production validation. No
model weights were downloaded and no multilingual quality or latency benchmark
was run for this note.

## Decision

| Layer | Decision | License / immutable anchor | Source-level coverage | Hard ceiling before validation |
|---|---|---|---|---|
| ASR | Keep multilingual Whisper; use `transcribe`, not Whisper's X-to-English `translate`, before many-to-many MT. | OpenAI Whisper source `5f86d1d86363843179951550570367b37c5d6f78`; model artifacts remain separately pinned. | Current language table: 100 codes. Pre-`large-v3` multilingual checkpoints expose 99; `large-v3` added Cantonese (`yue`). | A token is decoder eligibility, not an accuracy claim. OpenAI reports strong ASR in only about 10 languages and explicitly warns of uneven accuracy, hallucination, repetition, accent and dialect disparities. |
| MT | M2M100 418M is implemented as the many-to-many adapter; deployed L4 conversion and pair-by-pair acceptance remain pending. | MIT; `facebook/m2m100_418M@55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636`. | 100 languages and 9,900 ordered non-self directions. | The model card does not certify conversational quality for every direction. INT8 conversion is also a separate quality variable. |
| TTS | Keep Kokoro only for explicitly supported target locales. Unsupported targets remain captions-only; never substitute a nearby voice silently. | Apache-2.0; `hexgrad/Kokoro-82M@f3ff3571791e39611d31c381e3a41a3af07b4987`; `kokoro==0.9.4`. | Nine locale groups, 54 voices, representing eight product language codes: `en`, `ja`, `zh` (Mandarin), `es`, `fr`, `hi`, `it`, `pt` (Brazilian). | The official voice notes warn that non-English support can be thin, short utterances can be weak, and long utterances can rush. This is especially material for live conversation. |
| NLLB-200 distilled 600M | Rejected for this product path. Do not download, convert, or ship it. | CC BY-NC 4.0; `facebook/nllb-200-distilled-600M@f8d333a098d19b4fd9a8b18f94170487ad3f821d`. | Card says 200 languages; Hub metadata currently lists 196 language tags. | Non-commercial license, and Meta says the research model is not released for production deployment. Re-open only with separately confirmed commercial rights and a new production decision. |
| MADLAD-400 3B MT | Future evaluation only; not part of the present implementation plan. | Apache-2.0; `google/madlad400-3b-mt@fa184c675da0b5c9e1c8694fccd4e12e2d422094`. | Hub metadata lists 419 languages; training/card prose says 400+ or over 450, depending on the corpus/checkpoint claim. | 3B parameters, general-domain research model, only 204 languages evaluated, and not assessed for production. CTranslate2 compatibility and live latency remain unproven. |

Sources: [S1]-[S18]. Every source was accessed on 2026-08-14.

## 1. Whisper language-token coverage

The pinned OpenAI tokenizer source contains these 100 language entries [S1]:

```text
en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs
ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk
br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu
am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su yue
```

This table is not the same as the tokens exposed by every checkpoint:

- `get_tokenizer` defaults to 99 language tokens, while `Whisper.num_languages`
  derives the usable count from the loaded model vocabulary [S1][S2].
- OpenAI's `large-v3` release added the new Cantonese token `yue`; earlier
  multilingual checkpoints therefore expose 99, while `large-v3`-family
  vocabulary exposes 100 [S3]. The deployed converted checkpoint must still be
  checked at preload; a model name alone is not a receipt for its tokenizer.
- Whisper's translation task is speech-to-English. It is not an arbitrary
  X-to-Y MT layer. For this design, declare or detect the source language,
  transcribe in that language, and then pass stable source text to the MT layer
  [S4].

The OpenAI model card makes the quality ceiling explicit: its non-English
training data represents 98 languages, performance is correlated with training
data, strong ASR results are reported in only about 10 languages, and output can
hallucinate or repeat. Accuracy is uneven across languages, accents, dialects,
and demographic groups [S4]. Therefore, a language token means **candidate for
testing**, never **supported in production**.

## 2. M2M100 418M coverage and license

Pin the official Meta-hosted artifact as follows [S5]:

```text
repo_id  = facebook/m2m100_418M
revision = 55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636
license  = MIT
```

The model card claims 100 languages and all 9,900 ordered non-self directions.
Its Hub metadata count is 101 only because the metadata includes the generic
`multilingual` tag in addition to the 100 actual language codes. The exact 100
codes are [S5]:

```text
af am ar ast az ba be bg bn br bs ca ceb cs cy da de el en es et fa ff fi fr
fy ga gd gl gu ha he hi hr ht hu hy id ig ilo is it ja jv ka kk km kn ko lb
lg ln lo lt lv mg mk ml mn mr ms my ne nl no ns oc or pa pl ps pt ro ru sd
si sk sl so sq sr ss su sv sw ta th tl tn tr uk ur uz vi wo xh yi yo zh zu
```

Live HEAD requests against the pinned Hugging Face resolve endpoints returned
these upstream LFS SHA-256 anchors on 2026-08-14 [S6][S7]:

```text
pytorch_model.bin       d907ea45e4e4b9db163382a6674f6218b3c59566fe06d77f4055c208b4e87ed1
sentencepiece.bpe.model d8f7c76ed2a5e0822be39f0a4f95a55eb19c78f4593ce609e2edbc2aea4d380a
```

The model card is a coverage statement, not a direction-by-direction quality
certificate. Every shipping direction still needs conversational, proper-name,
number, profanity, code-switching, and domain fixtures reviewed by speakers of
both languages. Round-trip translation is not an adequacy test because two
errors can cancel.

### Derived compatibility with Whisper

Comparing the two pinned official code lists gives 83 literal code overlaps.
Whisper spells Javanese `jw`, while M2M100 spells it `jv`; one explicit
`jw -> jv` normalization raises the semantic overlap to 84. This is a derived
compatibility calculation, not a quality result.

```text
Whisper-only (literal codes):
la mi te eu sn tg fo tk nn mt sa bo as tt haw jw yue

M2M100-only (literal codes):
ast ceb ff fy ga gd ig ilo jv lg ns or ss tn wo xh zu
```

Do not normalize any other code without an explicit language/locale decision.
In particular, `zh` does not distinguish all Sinitic languages, and Kokoro's
`zh` voice route is specifically Mandarin.

## 3. CTranslate2 conversion and runtime semantics

CTranslate2 officially lists M2M100 as supported and publishes the required
inference pattern [S8]:

1. Tokenization is external. Set `tokenizer.src_lang`, encode with the pinned
   Hugging Face tokenizer, and convert IDs to string tokens.
2. Transformers models do **not** receive required source special tokens
   implicitly from CTranslate2; use the tokenizer output that already contains
   them.
3. Force the target with
   `target_prefix=[[tokenizer.lang_code_to_token[target_code]]]`.
4. The forced language token is returned as the first hypothesis token; remove
   that token before detokenization, as the official M2M100 example does.
5. `Translator.translate_batch` consumes token lists, not raw strings. Pin
   decoding options such as beam size and maximum input/output length because
   they affect output and latency [S8][S9].

### Reproducible conversion recipe

Use the current project conversion baseline from
[`windows/requirements.txt`](windows/requirements.txt): Python 3.11,
`ctranslate2==4.8.0`, `transformers==5.14.1`, `sentencepiece==0.2.2`,
`huggingface-hub==1.26.0`, and the pinned CPU Torch build. Exact rebuilds must
also lock wheel hashes, OS, architecture, and converter command.

Do **not** rely on `TransformersConverter(repo_id, revision=SHA)` alone with
CTranslate2 4.8.0. At the pinned `v4.8.0` source commit
`54a546cec4262f9770d4674a0bfb4ac3c4f05698`, `revision` is forwarded to the
model-weight load, but `AutoConfig.from_pretrained`, tokenizer loading, and
`hf_hub_download` used for copied files do not consistently receive it [S10].
That can mix pinned weights with mutable configuration or tokenizer files.

The deterministic path is:

```python
from huggingface_hub import snapshot_download
from ctranslate2.converters import TransformersConverter

snapshot = snapshot_download(
    repo_id="facebook/m2m100_418M",
    revision="55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636",
    allow_patterns=[
        "config.json",
        "generation_config.json",
        "pytorch_model.bin",
        "sentencepiece.bpe.model",
        "special_tokens_map.json",
        "tokenizer_config.json",
        "vocab.json",
    ],
)
TransformersConverter(snapshot).convert(
    "m2m100-418m-55c2e61-int8",
    quantization="int8",
)
```

Hugging Face documents that a full-length commit hash is accepted as
`revision`, and that `snapshot_download` resolves a repository at that revision
[S11]. Conversion and serving must then be offline from the same local
snapshot. Load the tokenizer from `snapshot` with `local_files_only=True`; do
not load it again from mutable `main`.

After conversion, create and retain a SHA-256 manifest for every source-snapshot
file and every generated CTranslate2 file. Record the conversion package lock,
Python/platform identity, quantization, and command beside that manifest. Treat
the converted directory as a built artifact; never reconvert during a
scale-from-zero request.

### Runtime precision is part of the receipt

- Conversion quantization controls the type stored on disk, but CTranslate2 can
  convert weights again at load time. `compute_type="auto"` selects the fastest
  supported type for the current device and is therefore hardware-dependent
  [S12].
- Select an explicit `device` and `compute_type` for each certified deployment,
  query `ctranslate2.get_supported_compute_types(device)`, and record the
  effective `translator.compute_type`. Fail closed if it differs from the
  certified profile [S9][S12].
- INT8 is not an accuracy promise. Compare the converted artifact with the
  pinned source model on the exact acceptance corpus before enabling a pair.

## 4. Kokoro voice coverage and limitations

The official pinned voice inventory contains 54 voices across nine locale
groups [S13]:

| Locale group | Official inventory | Product code boundary |
|---|---:|---|
| American English | 11F + 9M | `en-US` |
| British English | 4F + 4M | `en-GB` |
| Japanese | 4F + 1M | `ja` |
| Mandarin Chinese | 4F + 4M | `zh` only as Mandarin |
| Spanish | 1F + 2M | `es` |
| French | 1F | `fr` |
| Hindi | 2F + 2M | `hi` |
| Italian | 1F + 1M | `it` |
| Brazilian Portuguese | 1F + 2M | `pt-BR`, not generic Portuguese |

The current model pin is [S14]:

```text
repo_id                   = hexgrad/Kokoro-82M
revision                  = f3ff3571791e39611d31c381e3a41a3af07b4987
kokoro-v1_0.pth SHA-256   = 496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4
Python package            = kokoro==0.9.4
wheel SHA-256             = a129dc6364a286bd6a92c396e9862459d3d3e45f2c15596ed5a94dcee5789efd
```

The package wheel hash comes from the official PyPI release metadata [S15].
The enabled production subset is smaller than the upstream inventory: it is
four TTS language codes and nine explicitly selected profiles. Official pinned
Hugging Face resolve HEAD responses supplied these exact LFS SHA-256 anchors
on 2026-08-14 [S19]; the runtime rejects any different downloaded voice file:

```text
en-us-af-heart  feb6de2a4ed45b3653eee237b058d0a581547de52a2916835b2e5c3e75fd5795
en-us-am-michael e8fdf4a6802791a80a614ae4f8a5db8295cc7c030bbe091379e8d26ec23db6c3
en-gb-bf-emma   0b710dc085c412b32df00eb48fb89a9f091b8f1fb56041f3ff4453e87da52903
en-gb-bm-fable  ca41f70de38c9e318fc073d05c597a3140a48f6d08559f70fbb48d1c39537fef
es-ef-dora      8e64be1348887dbd618d01163d2ee1a13daf6725262156c4e0baf0cf2522a722
es-em-alex      0b9ba562aa510ba78eb10903569c885d8b1c862a3fcfcfbdf2e9fd397d8a1299
fr-ff-siwis     b103e5d9e13f18e8b28b3b4a4decbae5ec1aaa08d5e6ae5b28185d974160b122
ja-jf-alpha     362860762a3287fadc1146e2260308556825fc9e4995ff2df964086f30ad3af6
ja-jm-kumo      80ac4d27cd2bb4147704d9401468fe8295e56e6105dcf6332fcc61855a084a31
```

The remaining documented Kokoro groups (`zh`, `hi`, `it`, and `pt`) are not
enabled in this release. They remain captions-only even though their upstream
voices are documented, until their live-speech ASR/MT/TTS route is separately
validated.

The upstream limitations are unusually relevant to a conversation product
[S13]:

- Non-English support can be absent or thin because of G2P weakness or limited
  training data; French has one voice.
- The reported sweet spot is about 100-200 tokens.
- Utterances shorter than roughly 10-20 tokens can be weaker. Live turns are
  commonly this short, so successful long-form demos do not clear the live gate.
- Utterances over roughly 400 tokens can rush.
- Voice grades are estimates and listening preference is subjective.

Accordingly, source-level availability permits only a **candidate** spoken
route for `en`, `ja`, `zh`, `es`, `fr`, `hi`, `it`, and `pt`. Only the exact
locale, voice, model revision, G2P dependency set, and representative listening
fixtures can earn production status. All other M2M100 targets must remain
captions-only unless a separately licensed and validated TTS engine is added.

## 5. NLLB non-commercial decision

The pinned Meta model card declares `cc-by-nc-4.0`, says the primary users are
researchers, and says the model is not released for production deployment
[S16]. It also excludes domain-specific medical/legal use, document
translation, and certified translation; input longer than 512 training tokens
may degrade, and evaluation outside Wikimedia is limited.

Decision: **NLLB is not an implementation option for this product.** The
non-commercial license alone is disqualifying for an ordinary commercial
product path, and the card independently withholds production intent. Do not
spend compute converting or benchmarking it. A future re-open requires a
separate commercial license/right-to-use decision; this note is not legal
advice.

## 6. MADLAD-400 3B is future-only

The pinned Google-hosted artifact is Apache-2.0, uses a T5-style 3B model, and
selects its target language with a `<2xx>` prefix [S17]. Hub metadata lists 419
languages. The card says the research model is general-domain, has not been
assessed for production, and was evaluated on only 204 supported languages.
The author paper describes the 419-language MADLAD corpus and larger released
MT experiments [S18].

Decision: keep `google/madlad400-3b-mt@fa184c675da0b5c9e1c8694fccd4e12e2d422094`
as a **future benchmark candidate only**. It has more than seven times the
parameter count of M2M100 418M, and official CTranslate2 documentation names
generic T5 support but does not certify this exact checkpoint. No third-party
pre-converted artifact should enter the trust boundary. Re-open only after the
M2M100 gate, with a locally converted official snapshot, the same pair corpus,
and measured cold/warm latency, memory, concurrency, and quality.

## 7. Shipping-language gate

Source coverage is only the first gate. A language or direction should have an
explicit state instead of disappearing or falling back silently:

1. `ASR_UNAVAILABLE`: source code absent from the loaded Whisper checkpoint.
2. `MT_UNAVAILABLE`: normalized source/target code absent from the pinned MT
   model.
3. `TTS_UNAVAILABLE`: captions may work, but no exact target locale/voice exists.
4. `NOT_VALIDATED`: artifacts exist, but native-speaker quality, short-speech,
   silence/hallucination, number/name, and latency gates have not passed.
5. `CAPTIONS_READY`: ASR and both required MT directions passed; voice did not.
6. `SPOKEN_READY`: ASR, both MT directions, TTS, and end-to-end browser playback
   passed on the exact pinned artifacts.

An ASR transcript error is input to MT, and an MT error is input to TTS. Report
stage-specific receipts; do not present an end-to-end failure as proof that the
last model alone is defective. Existing English/Spanish evidence does not
validate any newly listed language.

## Primary sources

- **[S1]** OpenAI Whisper tokenizer and language table at
  `5f86d1d86363843179951550570367b37c5d6f78`:
  <https://github.com/openai/whisper/blob/5f86d1d86363843179951550570367b37c5d6f78/whisper/tokenizer.py>
  (accessed 2026-08-14).
- **[S2]** OpenAI Whisper model vocabulary-derived language count at the same
  revision:
  <https://github.com/openai/whisper/blob/5f86d1d86363843179951550570367b37c5d6f78/whisper/model.py>
  (accessed 2026-08-14).
- **[S3]** OpenAI's `large-v3` release announcement adding Cantonese:
  <https://github.com/openai/whisper/discussions/1762>
  (accessed 2026-08-14).
- **[S4]** OpenAI Whisper model card, intended tasks and limitations:
  <https://github.com/openai/whisper/blob/5f86d1d86363843179951550570367b37c5d6f78/model-card.md>
  (accessed 2026-08-14).
- **[S5]** Meta M2M100 418M pinned model card, license and 100-language list:
  <https://huggingface.co/facebook/m2m100_418M/blob/55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636/README.md>
  (accessed 2026-08-14).
- **[S6]** Meta M2M100 pinned model-weight resolve endpoint (official response
  header supplied the LFS hash):
  <https://huggingface.co/facebook/m2m100_418M/resolve/55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636/pytorch_model.bin>
  (accessed with HEAD, 2026-08-14).
- **[S7]** Meta M2M100 pinned SentencePiece resolve endpoint:
  <https://huggingface.co/facebook/m2m100_418M/resolve/55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636/sentencepiece.bpe.model>
  (accessed with HEAD, 2026-08-14).
- **[S8]** Official CTranslate2 Transformers guide, including M2M100 special
  token and target-prefix semantics:
  <https://opennmt.net/CTranslate2/guides/transformers.html>
  (accessed 2026-08-14).
- **[S9]** Official CTranslate2 Translator API:
  <https://opennmt.net/CTranslate2/python/ctranslate2.Translator.html>
  (accessed 2026-08-14).
- **[S10]** CTranslate2 `v4.8.0` converter source at peeled tag commit
  `54a546cec4262f9770d4674a0bfb4ac3c4f05698`:
  <https://github.com/OpenNMT/CTranslate2/blob/54a546cec4262f9770d4674a0bfb4ac3c4f05698/python/ctranslate2/converters/transformers.py#L67-L188>
  (accessed 2026-08-14).
- **[S11]** Official Hugging Face Hub revision and snapshot-download guidance:
  <https://huggingface.co/docs/huggingface_hub/guides/download>
  (accessed 2026-08-14).
- **[S12]** Official CTranslate2 quantization, runtime conversion and
  `compute_type` behavior:
  <https://opennmt.net/CTranslate2/quantization.html>
  (accessed 2026-08-14).
- **[S13]** Hexgrad Kokoro pinned voice inventory and limitations:
  <https://huggingface.co/hexgrad/Kokoro-82M/blob/f3ff3571791e39611d31c381e3a41a3af07b4987/VOICES.md>
  (accessed 2026-08-14).
- **[S14]** Hexgrad Kokoro pinned model repository, license and artifacts:
  <https://huggingface.co/hexgrad/Kokoro-82M/tree/f3ff3571791e39611d31c381e3a41a3af07b4987>
  (accessed 2026-08-14).
- **[S15]** Official PyPI JSON metadata for `kokoro==0.9.4` and its wheel hash:
  <https://pypi.org/pypi/kokoro/0.9.4/json>
  (accessed 2026-08-14).
- **[S16]** Meta NLLB-200 distilled 600M pinned model card, license, intended use
  and limitations:
  <https://huggingface.co/facebook/nllb-200-distilled-600M/blob/f8d333a098d19b4fd9a8b18f94170487ad3f821d/README.md>
  (accessed 2026-08-14). License text:
  <https://creativecommons.org/licenses/by-nc/4.0/legalcode>
  (accessed 2026-08-14).
- **[S17]** Google-hosted MADLAD-400 3B MT pinned model card, license, usage and
  limitations:
  <https://huggingface.co/google/madlad400-3b-mt/blob/fa184c675da0b5c9e1c8694fccd4e12e2d422094/README.md>
  (accessed 2026-08-14).
- **[S18]** MADLAD-400 author paper:
  <https://arxiv.org/abs/2309.04662>
  (accessed 2026-08-14).
- **[S19]** Hexgrad Kokoro pinned voice resolve endpoints, one per enabled
  file; for example American English Heart:
  <https://huggingface.co/hexgrad/Kokoro-82M/resolve/f3ff3571791e39611d31c381e3a41a3af07b4987/voices/af_heart.pt>;
  the remaining exact filenames are `am_michael`, `bf_emma`, `bm_fable`,
  `ef_dora`, `em_alex`, `ff_siwis`, `jf_alpha`, and `jm_kumo` with `.pt`
  suffixes at the same pinned revision (accessed with HEAD, 2026-08-14).

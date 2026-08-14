import sourceDocument from "../../capabilities.json";

type RawLanguage = {
  code: string;
  asr_code?: string;
  display_name: string;
  native_name: string;
  default_locale: string;
  region: string;
  script: string;
  rtl: boolean;
};

export type VoiceProfile = {
  id: string;
  style: "female" | "male";
  name: string;
  provider: "kokoro";
  pipeline: string;
  model_voice: string;
  quality_note: string;
};

export type LocaleProfile = {
  id: string;
  language: string;
  asr_code: string;
  mt_code: string;
  display_name: string;
  native_name: string;
  region: string;
  script: string;
  rtl: boolean;
  search_names: string[];
  mapping_note: string;
  dialect_quality_claim: false;
  capabilities: Record<"captions" | "tts", { available: boolean; reason: string }> & {
    asr: { available: boolean; tier: "verified" | "preview" | "unavailable"; reason: string };
  };
  voice_profiles: VoiceProfile[];
};

type RawDocument = {
  schema_version: string;
  revision: string;
  models: Record<string, unknown>;
  release_live_speech_languages: string[];
  model_live_speech_languages: string[];
  release_tts_profile_ids: string[];
  languages: RawLanguage[];
  regional_locales: Array<{
    id: string; language: string; display_name: string; native_name: string;
    region: string; script: string; rtl: boolean; voice_key?: string;
  }>;
  voice_profiles: Record<string, VoiceProfile[]>;
  capability_notes: Record<string, string>;
};

const document = sourceDocument as RawDocument;
const verifiedSpeech = new Set(document.release_live_speech_languages);
const modelSpeech = new Set(document.model_live_speech_languages);
const releaseTtsProfileIds = new Set(document.release_tts_profile_ids);
const languageByCode = new Map(document.languages.map(language => [language.code, language]));

function voiceKey(language: RawLanguage, regionalKey?: string): string {
  if (regionalKey !== undefined) return regionalKey;
  if (language.code === "en") return language.default_locale;
  return document.voice_profiles[language.code] ? language.code : "";
}

function profile(
  id: string, language: RawLanguage, displayName: string, nativeName: string,
  region: string, script: string, rtl: boolean, regionalVoiceKey?: string,
): LocaleProfile {
  const documentedVoices = document.voice_profiles[voiceKey(language, regionalVoiceKey)] || [];
  const voices = documentedVoices.filter(voice => releaseTtsProfileIds.has(voice.id))
    .map(voice => ({ ...voice }));
  const speech = modelSpeech.has(language.code);
  const speechTier = verifiedSpeech.has(language.code) ? "verified"
    : speech ? "preview" : "unavailable";
  return {
    id, language: language.code, asr_code: language.asr_code || language.code,
    mt_code: language.code,
    display_name: displayName, native_name: nativeName, region, script, rtl,
    search_names: [id, displayName, nativeName, region, language.code],
    mapping_note: `${id} maps to the same base language (${language.code}) as its related regional profiles; it does not select a distinct MT or ASR model.`,
    dialect_quality_claim: false,
    capabilities: {
      asr: { available: speech, tier: speechTier, reason: speechTier === "verified" ? ""
        : speechTier === "preview" ? "Model-supported preview."
        : "No Whisper to M2M100 source route." },
      captions: { available: true, reason: "Pinned M2M100 text translation is available for this base language." },
      tts: { available: voices.length > 0, reason: voices.length ? "" : documentedVoices.length
        ? "A documented provider voice exists, but it is not enabled for the release-tested live-speech runtime."
        : "No pinned synthetic voice profile is enabled for this locale." },
    },
    voice_profiles: voices,
  };
}

const locales: LocaleProfile[] = [
  ...document.languages.map(language => profile(
    language.default_locale, language,
    `${language.display_name} (${language.region})`,
    `${language.native_name} (${language.region})`,
    language.region, language.script, language.rtl,
  )),
  ...document.regional_locales.map(regional => {
    const language = languageByCode.get(regional.language);
    if (!language) throw new Error(`catalog references unknown language ${regional.language}`);
    // An omitted key deliberately means no regional voice profile, not a
    // fallback that would make a regional quality claim.
    return profile(regional.id, language, regional.display_name, regional.native_name,
      regional.region, regional.script, regional.rtl, regional.voice_key ?? "");
  }),
];

if (document.languages.length !== 100 || new Set(document.languages.map(item => item.code)).size !== 100) {
  throw new Error("catalog must have exactly 100 M2M100 base languages");
}
if (modelSpeech.size !== 84 || [...verifiedSpeech].some(code => !modelSpeech.has(code))) {
  throw new Error("catalog must declare the exact verified/model speech tiers");
}
if (locales.length < 117 || new Set(locales.map(item => item.id)).size !== locales.length) {
  throw new Error("catalog locale profiles must be unique and include at least 117 entries");
}

const localeById = new Map(locales.map(locale => [locale.id, locale]));
const voiceById = new Map(locales.flatMap(locale =>
  locale.voice_profiles.map(voice => [voice.id, voice] as const),
));

export const CATALOG_REVISION = document.revision;
export const M2M_MODEL = document.models.mt as { id: string; revision: string; license: string };

export function publicCatalog(): Record<string, unknown> {
  const voiceLanguageCount = new Set(locales.filter(locale => locale.voice_profiles.length)
    .map(locale => locale.language)).size;
  return JSON.parse(JSON.stringify({
    schema_version: document.schema_version,
    revision: document.revision,
    models: document.models,
    release_live_speech_languages: [...verifiedSpeech].sort(),
    model_live_speech_languages: [...modelSpeech].sort(),
    counts: {
      base_languages: document.languages.length,
      locale_profiles: locales.length,
      live_speech_languages: modelSpeech.size,
      model_speech_languages: modelSpeech.size,
      verified_speech_languages: verifiedSpeech.size,
      joinable_locale_profiles: locales.filter(locale => locale.capabilities.asr.available).length,
      text_languages: document.languages.length,
      voice_languages: voiceLanguageCount,
      voice_profiles: voiceById.size,
    },
    capability_notes: document.capability_notes,
    languages: document.languages.map(language => ({
      code: language.code, asr_code: language.asr_code || language.code,
      mt_code: language.code, display_name: language.display_name,
      native_name: language.native_name, script: language.script, rtl: language.rtl,
    })),
    locales,
  }));
}

export function localeProfile(locale: unknown): LocaleProfile | null {
  return typeof locale === "string" ? localeById.get(locale) || null : null;
}

export function isJoinableLocale(locale: unknown): boolean {
  return Boolean(localeProfile(locale)?.capabilities.asr.available);
}

export function voiceProfile(id: unknown, locale?: unknown): VoiceProfile | null {
  if (typeof id !== "string") return null;
  const candidate = voiceById.get(id);
  if (!candidate) return null;
  if (locale !== undefined && !localeProfile(locale)?.voice_profiles.some(voice => voice.id === id)) {
    return null;
  }
  return candidate;
}

"""Shared, fail-closed multilingual capability catalog.

``capabilities.json`` is deliberately data-first.  This adapter expands one
default locale per M2M100 language plus the explicit regional profiles, so the
browser, Worker, Modal compute adapter, local server, and tests can consume the
same declared contract without copying language constants.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any


_DOCUMENT_PATH = Path(__file__).resolve().parents[1] / "capabilities.json"
_DOCUMENT = json.loads(_DOCUMENT_PATH.read_text(encoding="utf-8"))
_LIVE_SPEECH = frozenset(_DOCUMENT["release_live_speech_languages"])
_LANGUAGES = tuple(_DOCUMENT["languages"])
_LANGUAGE_BY_CODE = {entry["code"]: entry for entry in _LANGUAGES}
_VOICE_SETS: dict[str, list[dict[str, Any]]] = _DOCUMENT["voice_profiles"]
_RELEASE_TTS_PROFILE_IDS = frozenset(_DOCUMENT["release_tts_profile_ids"])


def _voice_key(language: dict[str, Any], override: str | None = None) -> str:
    if override is not None:
        return override
    if language["code"] == "en":
        return language["default_locale"]
    return language["code"] if language["code"] in _VOICE_SETS else ""


def _profile(
    *,
    locale_id: str,
    language: dict[str, Any],
    display_name: str,
    native_name: str,
    region: str,
    script: str,
    rtl: bool,
    voice_key: str | None = None,
) -> dict[str, Any]:
    base = language["code"]
    documented_voices = _VOICE_SETS.get(_voice_key(language, voice_key), [])
    voices = copy.deepcopy([
        voice for voice in documented_voices if voice["id"] in _RELEASE_TTS_PROFILE_IDS
    ])
    speech_available = base in _LIVE_SPEECH
    return {
        "id": locale_id,
        "language": base,
        "asr_code": base,
        "mt_code": base,
        "display_name": display_name,
        "native_name": native_name,
        "region": region,
        "script": script,
        "rtl": rtl,
        "search_names": [locale_id, display_name, native_name, region, base],
        "mapping_note": (
            f"{locale_id} maps to the same base language ({base}) as its related "
            "regional profiles; it does not select a distinct MT or ASR model."
        ),
        "dialect_quality_claim": False,
        "capabilities": {
            "asr": {
                "available": speech_available,
                "reason": "" if speech_available else (
                    "Not in the release-tested Whisper ∩ M2M100 live-speech set."
                ),
            },
            "captions": {
                "available": True,
                "reason": "Pinned M2M100 text translation is available for this base language.",
            },
            "tts": {
                "available": bool(voices),
                "reason": "" if voices else (
                    "No pinned synthetic voice profile is enabled for this locale."
                    if not documented_voices else
                    "A documented provider voice exists, but it is not enabled for the "
                    "release-tested live-speech runtime."
                ),
            },
        },
        "voice_profiles": voices,
    }


def _build_locales() -> tuple[dict[str, Any], ...]:
    locales: list[dict[str, Any]] = []
    for language in _LANGUAGES:
        locales.append(_profile(
            locale_id=language["default_locale"],
            language=language,
            display_name=f"{language['display_name']} ({language['region']})",
            native_name=f"{language['native_name']} ({language['region']})",
            region=language["region"],
            script=language["script"],
            rtl=language["rtl"],
        ))
    for regional in _DOCUMENT["regional_locales"]:
        language = _LANGUAGE_BY_CODE[regional["language"]]
        locales.append(_profile(
            locale_id=regional["id"],
            language=language,
            display_name=regional["display_name"],
            native_name=regional["native_name"],
            region=regional["region"],
            script=regional["script"],
            rtl=regional["rtl"],
            voice_key=regional.get("voice_key") or "",
        ))
    ids = [entry["id"] for entry in locales]
    if len(_LANGUAGES) != 100 or len(_LANGUAGE_BY_CODE) != 100:
        raise RuntimeError("catalog must declare exactly 100 M2M100 base languages")
    if len(ids) != len(set(ids)):
        raise RuntimeError("catalog locale IDs must be unique")
    if len(locales) < 117:
        raise RuntimeError("catalog must declare at least 117 locale profiles")
    return tuple(locales)


_LOCALES = _build_locales()
_LOCALE_BY_ID = {entry["id"]: entry for entry in _LOCALES}
_VOICE_BY_ID = {
    voice["id"]: voice
    for locale in _LOCALES for voice in locale["voice_profiles"]
}


def public_catalog() -> dict[str, Any]:
    """Return a detached public catalog safe for HTTP serialization."""
    languages = [
        {
            "code": language["code"],
            "mt_code": language["code"],
            "display_name": language["display_name"],
            "native_name": language["native_name"],
            "script": language["script"],
            "rtl": language["rtl"],
        }
        for language in _LANGUAGES
    ]
    return copy.deepcopy({
        "schema_version": _DOCUMENT["schema_version"],
        "revision": _DOCUMENT["revision"],
        "models": _DOCUMENT["models"],
        "release_live_speech_languages": sorted(_LIVE_SPEECH),
        "counts": {
            "base_languages": len(_LANGUAGES),
            "locale_profiles": len(_LOCALES),
            "live_speech_languages": len(_LIVE_SPEECH),
            "text_languages": len(_LANGUAGES),
            "voice_languages": len({entry["language"] for entry in _LOCALES
                                    if entry["voice_profiles"]}),
            "voice_profiles": len(_VOICE_BY_ID),
        },
        "capability_notes": _DOCUMENT["capability_notes"],
        "languages": languages,
        "locales": list(_LOCALES),
    })


def locale_profile(locale_id: object) -> dict[str, Any] | None:
    """Look up one explicit BCP-47 profile without falling back silently."""
    return copy.deepcopy(_LOCALE_BY_ID.get(locale_id)) if isinstance(locale_id, str) else None


def base_language(locale_id: object) -> str | None:
    profile = _LOCALE_BY_ID.get(locale_id) if isinstance(locale_id, str) else None
    return profile["language"] if profile else None


def is_joinable_locale(locale_id: object) -> bool:
    profile = _LOCALE_BY_ID.get(locale_id) if isinstance(locale_id, str) else None
    return bool(profile and profile["capabilities"]["asr"]["available"])


def voice_profiles(locale_id: object) -> list[dict[str, Any]]:
    profile = _LOCALE_BY_ID.get(locale_id) if isinstance(locale_id, str) else None
    return copy.deepcopy(profile["voice_profiles"]) if profile else []


def voice_profile(profile_id: object, locale_id: object | None = None) -> dict[str, Any] | None:
    """Resolve an explicitly selected voice, optionally constrained to its locale."""
    if not isinstance(profile_id, str):
        return None
    candidate = _VOICE_BY_ID.get(profile_id)
    if not candidate:
        return None
    if locale_id is not None and profile_id not in {
        voice["id"] for voice in voice_profiles(locale_id)
    }:
        return None
    return copy.deepcopy(candidate)


def search_locales(query: object, limit: int = 30) -> list[dict[str, Any]]:
    """Case-insensitive native/English/region locale search for the picker."""
    if not isinstance(query, str):
        return []
    needle = query.casefold().strip()
    matches = _LOCALES if not needle else tuple(
        profile for profile in _LOCALES
        if any(needle in str(term).casefold() for term in profile["search_names"])
    )
    return copy.deepcopy(list(matches[:max(0, min(limit, 100))]))

# Multilingual room glossary

## Language

A base linguistic system supported by a translation model, such as `es`.

## Locale

A BCP-47 regional or script preference, such as `es-MX` or `es-ES`. A locale
maps to one base Language and does not imply a distinct machine-translation
model or dialect-specific ASR or MT quality.

## Capability

The independently declared availability of ASR, MT/captions, and TTS, including
an explicit reason whenever one is unavailable.

## Translation Route

One speaker transcription that fans out once to the unique base Languages of
the current listeners. It never duplicates ASR for each target.

## Voice Profile

An explicitly selected synthetic voice for a target Language or Locale. It is
never biometric inference or voice cloning.

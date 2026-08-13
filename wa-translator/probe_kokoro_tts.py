#!/usr/bin/env python3
"""Synthesize and hash every controlled production Kokoro route."""

import argparse
import hashlib
import json
import tempfile
import wave
from pathlib import Path

from modal_app import KokoroTTS, VOICE_ROUTES


TEXT = {
    "en": "Your translated voice is ready.",
    "es": "Tu voz traducida está lista.",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path,
                        default=Path(tempfile.gettempdir()) / "kokoro-probes")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    engine = KokoroTTS()
    for lang, style in VOICE_ROUTES:
        audio = engine.synthesize(TEXT[lang], lang, style)
        path = args.output / f"{lang}-{style}.wav"
        path.write_bytes(audio)
        with wave.open(str(path), "rb") as wav_file:
            receipt = {
                "route": f"{lang}-{style}",
                "bytes": len(audio),
                "sample_rate": wav_file.getframerate(),
                "frames": wav_file.getnframes(),
                "sha256": hashlib.sha256(audio).hexdigest(),
                "path": str(path.resolve()),
            }
        if not audio.startswith(b"RIFF") or receipt["sample_rate"] != 24_000:
            raise RuntimeError(f"invalid Kokoro WAV for {lang}-{style}")
        print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

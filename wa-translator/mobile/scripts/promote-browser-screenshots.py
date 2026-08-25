from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
SHOTS = ROOT.parent / "tools" / "browser" / "shots"
TARGET = ROOT / "store" / "screenshots" / "en-US"
CAPTURE_SIZE = (390, 844)
MAPPING = (
    ("dash-en.png", "01-dashboard.png"),
    ("dash-en-room.png", "02-room-control.png"),
    ("gate-en.png", "03-choose-language.png"),
    ("room-live-en.png", "04-room.png"),
)


def fail(message: str) -> None:
    raise SystemExit(f"Store screenshot promotion refused: {message}")


def current_head() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
    ).strip()


def load_manifest() -> dict[str, object]:
    path = SHOTS / "capture.json"
    if not path.is_file():
        fail("browser capture manifest is missing; run `node tools/browser/run.mjs en` first")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"browser capture manifest is unreadable ({error})")
    if not isinstance(value, dict) or value.get("schema") != 1:
        fail("browser capture manifest has an unsupported schema")
    return value


def validate_capture(path: Path) -> None:
    if not path.is_file():
        fail(f"required browser capture is missing: {path.name}")
    try:
        with Image.open(path) as image:
            if image.format != "PNG":
                fail(f"{path.name} is not PNG")
            if image.size != CAPTURE_SIZE:
                fail(f"{path.name} is {image.size[0]}x{image.size[1]}, expected {CAPTURE_SIZE[0]}x{CAPTURE_SIZE[1]}")
            image.verify()
    except OSError as error:
        fail(f"{path.name} is not a valid image ({error})")


def main() -> None:
    manifest = load_manifest()
    head = current_head()
    if manifest.get("head") != head:
        fail(f"capture head {manifest.get('head')} does not match current head {head}")
    languages = manifest.get("languages")
    if not isinstance(languages, list) or "en" not in languages:
        fail("capture did not include the required en-US browser sweep")

    TARGET.mkdir(parents=True, exist_ok=True)
    for source_name, target_name in MAPPING:
        source = SHOTS / source_name
        validate_capture(source)
        shutil.copy2(source, TARGET / target_name)

    print(f"Promoted {len(MAPPING)} exact-head en-US browser captures from {head}.")
    print("Run `python scripts/prepare-store-screenshots.py` to produce Android/iOS listing sizes.")


if __name__ == "__main__":
    main()

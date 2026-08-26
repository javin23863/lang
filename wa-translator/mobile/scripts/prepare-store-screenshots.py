from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "store" / "screenshots" / "en-US"
PROVENANCE = SOURCE / "promotion.json"
ANDROID = ROOT / "fastlane" / "metadata" / "android" / "en-US" / "images" / "phoneScreenshots"
IOS = ROOT / "fastlane" / "screenshots" / "en-US"
RECEIPT = ROOT / "build" / "store-screenshot-receipt.json"
INPUTS = (
    ("01-dashboard.png", "01-dashboard.png"),
    ("02-room-control.png", "02-room-control.png"),
    ("03-choose-language.png", "03-choose-language.png"),
    ("04-room.png", "04-room.png"),
)


def fail(message: str) -> None:
    raise SystemExit(f"Store screenshot preparation refused: {message}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_provenance() -> dict[str, object]:
    if not PROVENANCE.is_file():
        fail("promotion.json is missing; promote exact-head browser captures first")
    try:
        value = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"promotion.json is unreadable ({error})")
    if not isinstance(value, dict) or value.get("schema") != 1:
        fail("promotion.json has an unsupported schema")
    source_head = value.get("source_head")
    if not isinstance(source_head, str) or not re.fullmatch(r"[0-9a-f]{40}", source_head):
        fail("promotion.json source_head is not an exact commit SHA")
    if value.get("capture_size") != [390, 844]:
        fail("promotion.json capture size is not 390x844")
    return value


def validate_inputs(provenance: dict[str, object]) -> None:
    records = provenance.get("files")
    if not isinstance(records, list):
        fail("promotion.json files list is missing")
    expected_targets = [source_name for source_name, _ in INPUTS]
    by_target: dict[str, dict[str, object]] = {}
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("target"), str):
            fail("promotion.json contains an invalid file record")
        by_target[record["target"]] = record
    if sorted(by_target) != sorted(expected_targets):
        fail("promotion.json does not describe exactly the required store screenshots")
    for target_name in expected_targets:
        path = SOURCE / target_name
        if not path.is_file():
            fail(f"promoted screenshot is missing: {target_name}")
        expected_hash = by_target[target_name].get("sha256")
        if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            fail(f"promotion.json has no valid SHA-256 for {target_name}")
        if sha256(path) != expected_hash:
            fail(f"promoted screenshot changed after exact-head promotion: {target_name}")


def write_set(target: Path, size: tuple[int, int]) -> list[dict[str, str]]:
    target.mkdir(parents=True, exist_ok=True)
    for stale in target.glob("*.png"):
        stale.unlink()
    outputs: list[dict[str, str]] = []
    for source_name, output_name in INPUTS:
        output = target / output_name
        with Image.open(SOURCE / source_name) as image:
            image.convert("RGB").resize(size, Image.Resampling.LANCZOS).save(
                output, optimize=True
            )
        outputs.append({"file": output_name, "sha256": sha256(output)})
    return outputs


def main() -> None:
    provenance = load_provenance()
    validate_inputs(provenance)
    android = write_set(ANDROID, (1080, 2340))
    ios = write_set(IOS, (1290, 2796))

    RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    RECEIPT.write_text(json.dumps({
        "schema": 1,
        "source_head": provenance["source_head"],
        "origin": provenance.get("origin"),
        "languages": provenance.get("languages"),
        "captured_at": provenance.get("captured_at"),
        "source_capture_size": provenance["capture_size"],
        "platforms": {
            "android": {"size": [1080, 2340], "files": android},
            "ios": {"size": [1290, 2796], "files": ios},
        },
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Store screenshot receipt: {RECEIPT}")


if __name__ == "__main__":
    main()

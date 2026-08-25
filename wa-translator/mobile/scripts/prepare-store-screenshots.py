from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "store" / "screenshots" / "en-US"
ANDROID = ROOT / "fastlane" / "metadata" / "android" / "en-US" / "images" / "phoneScreenshots"
IOS = ROOT / "fastlane" / "screenshots" / "en-US"
INPUTS = (
    ("01-dashboard.png", "01-dashboard.png"),
    ("02-room-control.png", "02-room-control.png"),
    ("03-choose-language.png", "03-choose-language.png"),
    ("04-room.png", "04-room.png"),
)


def write_set(target: Path, size: tuple[int, int]) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for stale in target.glob("*.png"):
        stale.unlink()
    for source_name, output_name in INPUTS:
        with Image.open(SOURCE / source_name) as image:
            image.convert("RGB").resize(size, Image.Resampling.LANCZOS).save(
                target / output_name, optimize=True
            )


write_set(ANDROID, (1080, 2340))
write_set(IOS, (1290, 2796))

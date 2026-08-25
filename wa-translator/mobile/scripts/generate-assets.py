from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ANDROID = ROOT / "android" / "app" / "src" / "main" / "res"
IOS = ROOT / "ios" / "App" / "App" / "Assets.xcassets"
PLAY_STORE = ROOT / "fastlane" / "metadata" / "android" / "en-US" / "images"
GREEN = "#075E54"
BLUE = "#53BDEB"
CREAM = "#F4FBF9"


def symbol(size: int, *, background: bool, round_icon: bool = False) -> Image.Image:
    scale = 4
    px = size * scale
    image = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if background:
        radius = px // 2 if round_icon else int(px * 0.22)
        draw.rounded_rectangle((0, 0, px, px), radius=radius, fill=GREEN)

    inset = int(px * (0.19 if background else 0.17))
    x1, y1, x2, y2 = inset, int(px * 0.22), int(px * 0.72), int(px * 0.60)
    radius = int(px * 0.09)
    draw.rounded_rectangle((x1, y1, x2, y2), radius=radius, fill="white")
    draw.polygon(
        [(int(px * 0.29), y2 - 2), (int(px * 0.24), int(px * 0.72)), (int(px * 0.40), y2 - 2)],
        fill="white",
    )
    bx1, by1, bx2, by2 = int(px * 0.43), int(px * 0.47), int(px * 0.84), int(px * 0.73)
    draw.rounded_rectangle((bx1, by1, bx2, by2), radius=radius, fill=BLUE)
    draw.polygon(
        [(int(px * 0.66), by2 - 2), (int(px * 0.78), int(px * 0.82)), (int(px * 0.74), by2 - 2)],
        fill=BLUE,
    )
    stroke = max(5, int(px * 0.025))
    for frac in (0.35, 0.42, 0.49):
        x = int(px * frac)
        draw.line((x, int(px * 0.33), x, int(px * 0.49)), fill=GREEN, width=stroke)
    draw.line(
        (int(px * 0.54), int(px * 0.57), int(px * 0.73), int(px * 0.57)),
        fill="white",
        width=stroke,
    )
    draw.line(
        (int(px * 0.54), int(px * 0.64), int(px * 0.68), int(px * 0.64)),
        fill="white",
        width=stroke,
    )
    return image.resize((size, size), Image.Resampling.LANCZOS)


def splash(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), CREAM)
    mark_size = max(128, min(width, height) // 3)
    mark = symbol(mark_size, background=True)
    image.paste(mark, ((width - mark_size) // 2, (height - mark_size) // 2), mark)
    return image


def feature_graphic() -> Image.Image:
    """Google Play's mandatory 1024x500, no-alpha listing graphic."""
    image = Image.new("RGB", (1024, 500), GREEN)
    draw = ImageDraw.Draw(image)

    # Two overlapping conversation cards echo the product icon without adding
    # marketing copy that would need separate localized artwork.
    draw.rounded_rectangle((90, 82, 610, 372), radius=54, fill=CREAM)
    draw.polygon([(180, 364), (150, 430), (270, 364)], fill=CREAM)
    draw.rounded_rectangle((470, 154, 934, 386), radius=48, fill=BLUE)
    draw.polygon([(778, 378), (850, 438), (824, 378)], fill=BLUE)

    mark = symbol(190, background=True)
    image.paste(mark, (145, 132), mark)

    line_width = 18
    for y, width in ((214, 250), (264, 320), (314, 220)):
        draw.rounded_rectangle((615, y, 615 + width, y + line_width), radius=9, fill="white")
    return image


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    symbol(1024, background=True).convert("RGB").save(ASSETS / "icon-1024.png", optimize=True)
    splash(2732, 2732).save(ASSETS / "splash-2732.png", optimize=True)

    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in densities.items():
        directory = ANDROID / f"mipmap-{density}"
        symbol(size, background=True).save(directory / "ic_launcher.png", optimize=True)
        symbol(size, background=True, round_icon=True).save(directory / "ic_launcher_round.png", optimize=True)
        symbol(size, background=False).save(directory / "ic_launcher_foreground.png", optimize=True)

    for path in ANDROID.rglob("splash.png"):
        with Image.open(path) as existing:
            width, height = existing.size
        splash(width, height).save(path, optimize=True)

    ios_icon = IOS / "AppIcon.appiconset" / "AppIcon-512@2x.png"
    symbol(1024, background=True).convert("RGB").save(ios_icon, optimize=True)
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        splash(2732, 2732).save(IOS / "Splash.imageset" / name, optimize=True)

    PLAY_STORE.mkdir(parents=True, exist_ok=True)
    # Play requires a 512x512 32-bit PNG listing icon and a 1024x500 JPEG or
    # 24-bit PNG feature graphic. Keep both deterministic and source-derived.
    symbol(512, background=True).save(PLAY_STORE / "icon.png", optimize=True)
    feature_graphic().save(PLAY_STORE / "featureGraphic.png", optimize=True)


if __name__ == "__main__":
    main()

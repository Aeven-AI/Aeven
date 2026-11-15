"""Turns a folder of exported Figma frames into a design-system file.

Reads the frames the way the first two systems were read by hand: dominant
colours over the whole deck, the page colour of the plainest frame, the accent as
the most saturated frequent colour, the ink as the darkest frequent colour, the
largest ink band as the title size, and the smallest left edge as the margin.
Frame names become the layout inventory, since Figma decks name their frames by
layout kind.

Usage: python3 extract.py <frames-dir> <system-id> [output-root]
"""
from __future__ import annotations

import colorsys
import json
import re
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

SCALE = 64  # sampling grid; enough for palette and band detection


def load(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def palette(frames: list[Image.Image]) -> list[tuple[tuple[int, int, int], float]]:
    counts: Counter = Counter()
    total = 0
    for frame in frames:
        small = frame.resize((SCALE, int(SCALE * frame.height / frame.width)))
        for colour in small.getdata():
            counts[tuple(round(channel / 12) * 12 for channel in colour)] += 1
            total += 1
    return [(colour, count / total) for colour, count in counts.most_common(12)]


def luminance(colour: tuple[int, int, int]) -> float:
    return (0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]) / 255


def saturation(colour: tuple[int, int, int]) -> float:
    _, _, light = colorsys.rgb_to_hls(*[channel / 255 for channel in colour])
    return max(colour) - min(colour)


def hexed(colour: tuple[int, int, int]) -> str:
    return "#%02X%02X%02X" % colour


def bands(frame: Image.Image) -> list[tuple[int, int, int]]:
    """Text bands, as (height, left-edge, ink-coverage) triples.

    A band whose ink covers most of its area is a photo or a filled block, not a
    line of type, so coverage separates the two: type sits well under half.
    """
    width, height = frame.size
    pixels = frame.load()
    found = []
    inside = False
    start = 0
    for y in range(height):
        row = [pixels[x, y] for x in range(0, width, max(1, width // 240))]
        lum = [luminance(colour) for colour in row]
        ink = max(lum) - min(lum) > 0.16
        if ink and not inside:
            start, inside = y, True
        elif not ink and inside:
            found.append((start, y - 1))
            inside = False
    if inside:
        found.append((start, height - 1))
    out = []
    for begin, end in found:
        if end - begin < 4:
            continue
        samples = [
            (x, y)
            for y in range(begin, end + 1, 2)
            for x in range(0, width, 2)
        ]
        lum = [luminance(pixels[x, y]) for x, y in samples]
        background = max(set(lum), key=lum.count)
        marked = [x for x, y in samples if abs(luminance(pixels[x, y]) - background) > 0.18]
        coverage = len(marked) / max(1, len(samples))
        left = min(marked) if marked else 0
        out.append((end - begin + 1, left, coverage))
    return out


def main() -> None:
    frames_dir = Path(sys.argv[1])
    system_id = sys.argv[2]
    out_root = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parent.parent / "systems"
    files = sorted(frames_dir.glob("*.png"))
    if not files:
        raise SystemExit(f"no frames in {frames_dir}")

    images = [load(path) for path in files]
    ranked = palette(images)
    page = max(ranked, key=lambda item: item[1])[0]
    accent_pool = [item for item in ranked if saturation(item[0]) > 40 and item[1] > 0.004]
    accent = max(accent_pool, key=lambda item: saturation(item[0]))[0] if accent_pool else ranked[1][0]
    darks = [item for item in ranked if luminance(item[0]) < 0.3 and item[1] > 0.005]
    lights = [item for item in ranked if luminance(item[0]) > 0.9 and item[1] > 0.01]
    ink = darks[0][0] if darks else (30, 30, 30)
    white = lights[0][0] if lights else (255, 255, 255)

    heights = []
    margins = []
    for image in images:
        for height, left, coverage in bands(image):
            if coverage > 0.45:
                continue
            heights.append(height)
            if left > 0:
                margins.append(left)
    heights.sort()
    margins.sort()
    margin = min(max(margins[len(margins) // 2] if margins else 64, 40), 96)
    title_px = heights[int(len(heights) * 0.98)] if heights else 60
    body_px = heights[len(heights) // 5] if len(heights) > 5 else 15

    def clamp(value: float, low: int, high: int) -> int:
        return int(min(max(round(value), low), high))

    preset = "paper"
    if luminance(page) < 0.35:
        preset = "contrast"
    elif luminance(page) > 0.7 and saturation(page) > 25:
        preset = "pastel"

    muted = next(
        (item[0] for item in ranked if 0.35 < luminance(item[0]) < 0.75 and saturation(item[0]) < 40),
        ink,
    )

    layouts = [re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-") for path in files]
    card = "#16222C" if preset == "contrast" else ("#F2F2F4" if luminance(white) > 0.94 else hexed(white))

    system = {
        "id": system_id,
        "preset": preset,
        "name": frames_dir.name,
        "source": "",
        "measuredFrom": f"{len(files)} exported frames",
        "surface": {
            "page": hexed(page),
            "cover": hexed(page),
            "light": hexed(page),
            "card": card,
            "white": hexed(white),
        },
        "ink": {
            "primary": hexed(ink),
            "muted": hexed(muted),
            "onLight": hexed(ink),
            "onAccent": "#FFFFFF",
        },
        "accent": {"primary": hexed(accent), "art": [hexed(accent), hexed(page)]},
        "type": {
            "family": "grotesque",
            "titleCaps": preset == "contrast",
            "title": clamp(title_px / 0.72, 44, 84),
            "titleContent": clamp(title_px / 0.72 * 0.8, 36, 68),
            "titleCover": clamp(title_px / 0.72 * 1.3, 56, 96),
            "lead": clamp(body_px * 2.0, 18, 32),
            "body": clamp(body_px * 0.95, 12, 17),
            "caption": clamp(body_px * 0.9, 11, 16),
            "lineHeight": 1.4,
        },
        "geometry": {
            "margin": margin,
            "radius": 12,
            "hairline": "rgba(127,127,127,.28)",
        },
        "motif": "",
        "layouts": layouts,
    }

    destination = out_root / system_id / "system.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(system, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {destination} ({preset}, page {hexed(page)}, accent {hexed(accent)})")


if __name__ == "__main__":
    main()

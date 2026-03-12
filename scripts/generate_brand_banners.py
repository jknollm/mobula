#!/usr/bin/env python3
"""Generate Mobula brand banners for app (white text) and README (black text).

Outputs in src/mobula/static/assets:
- mobula_banner_black.png
- mobula_banner_black.svg
- mobula_banner_white.png
- mobula_banner_white.svg
- mobula_banner.png        (canonical README banner -> black)
- mobula_banner.svg        (canonical README banner -> black)
"""

from __future__ import annotations

import argparse
import base64
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Pillow is required to generate banners. Install it with: pip install Pillow") from exc


WORDMARK = "MOBULA"
TAGLINE = "Navigating Domains"


def _load_font(path: Path, size: int, weight: int | None = None) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(path), size)
    if weight is not None and hasattr(font, "set_variation_by_axes"):
        try:
            font.set_variation_by_axes([weight])
        except Exception:
            pass
    return font


def _draw_tracked(
    draw: ImageDraw.ImageDraw,
    x: float,
    baseline_y: float,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    tracking: float,
    *,
    stroke_width: int = 0,
    stroke_fill: tuple[int, int, int, int] | None = None,
) -> None:
    cursor = x
    for idx, char in enumerate(text):
        draw.text(
            (cursor, baseline_y),
            char,
            font=font,
            fill=fill,
            anchor="ls",
            stroke_width=stroke_width,
            stroke_fill=stroke_fill if stroke_fill is not None else fill,
        )
        if idx < len(text) - 1:
            cursor += draw.textlength(char, font=font) + tracking


def _rgba_svg(color: tuple[int, int, int, int]) -> str:
    r, g, b, a = color
    alpha = a / 255.0
    return f"rgba({r},{g},{b},{alpha:.3f})"


def generate(root: Path) -> None:
    assets = root / "src" / "mobula" / "static" / "assets"
    fonts = assets / "fonts"

    logo_path = assets / "mobula_logo.png"
    michroma_path = fonts / "Michroma-Regular.ttf"
    source_sans_path = fonts / "SourceSans3-wght.ttf"

    missing = [str(p) for p in [logo_path, michroma_path, source_sans_path] if not p.exists()]
    if missing:
        raise SystemExit("Missing required files:\n" + "\n".join(missing))

    width, height = 900, 236
    logo_size = 210
    logo_x = 8
    logo_y = (height - logo_size) // 2
    text_x = logo_x + logo_size + 22

    word_font = _load_font(michroma_path, 94)
    tag_font = _load_font(source_sans_path, 56, 430)

    word_tracking = 8.0
    line_gap = 3
    tagline_lift = 12
    word_stroke = 1

    logo_b64 = base64.b64encode(logo_path.read_bytes()).decode("ascii")
    michroma_b64 = base64.b64encode(michroma_path.read_bytes()).decode("ascii")
    source_sans_b64 = base64.b64encode(source_sans_path.read_bytes()).decode("ascii")

    def _render(name: str, word_color: tuple[int, int, int, int], tag_color: tuple[int, int, int, int]) -> None:
        image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)

        word_width = sum(draw.textlength(ch, font=word_font) for ch in WORDMARK) + word_tracking * (len(WORDMARK) - 1)
        tag_width = draw.textbbox((0, 0), TAGLINE, font=tag_font)[2]
        tag_tracking = (word_width - tag_width) / max(1, len(TAGLINE) - 1)

        word_ascent, word_descent = word_font.getmetrics()
        tag_ascent, tag_descent = tag_font.getmetrics()
        word_height = word_ascent + word_descent
        tag_height = tag_ascent + tag_descent

        top = int((height - (word_height + line_gap + tag_height)) / 2)
        word_baseline = top + word_ascent
        tag_baseline = top + word_height + line_gap + tag_ascent - tagline_lift

        logo = Image.open(logo_path).convert("RGBA").resize((logo_size, logo_size), Image.Resampling.LANCZOS)
        image.alpha_composite(logo, (logo_x, logo_y))

        _draw_tracked(
            draw,
            text_x,
            word_baseline,
            WORDMARK,
            word_font,
            word_color,
            word_tracking,
            stroke_width=word_stroke,
            stroke_fill=word_color,
        )
        _draw_tracked(
            draw,
            text_x,
            tag_baseline,
            TAGLINE,
            tag_font,
            tag_color,
            tag_tracking,
        )

        png_out = assets / f"mobula_banner_{name}.png"
        svg_out = assets / f"mobula_banner_{name}.svg"
        image.save(png_out)

        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <style>
      @font-face {{
        font-family: "MobulaMichroma";
        src: url("data:font/ttf;base64,{michroma_b64}") format("truetype");
      }}
      @font-face {{
        font-family: "MobulaSourceSans3";
        src: url("data:font/ttf;base64,{source_sans_b64}") format("truetype");
      }}
    </style>
  </defs>
  <image href="data:image/png;base64,{logo_b64}" x="{logo_x}" y="{logo_y}" width="{logo_size}" height="{logo_size}"/>
  <text x="{text_x}" y="{word_baseline}" fill="{_rgba_svg(word_color)}" font-family="MobulaMichroma, sans-serif" font-size="94" letter-spacing="8px" style="stroke:{_rgba_svg(word_color)};stroke-width:1;paint-order:stroke fill;">{WORDMARK}</text>
  <text x="{text_x}" y="{tag_baseline}" fill="{_rgba_svg(tag_color)}" font-family="MobulaSourceSans3, sans-serif" font-size="56" textLength="{word_width}" lengthAdjust="spacingAndGlyphs">{TAGLINE}</text>
</svg>
"""
        svg_out.write_text(svg, encoding="utf-8")

    _render("black", (0, 0, 0, 255), (0, 0, 0, 232))
    _render("white", (255, 255, 255, 255), (255, 255, 255, 232))

    # Canonical banner references stay black for README use.
    (assets / "mobula_banner.png").write_bytes((assets / "mobula_banner_black.png").read_bytes())
    (assets / "mobula_banner.svg").write_bytes((assets / "mobula_banner_black.svg").read_bytes())


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Mobula brand banners.")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root (defaults to repository root).",
    )
    args = parser.parse_args()
    generate(args.root.resolve())
    print("Generated white(app) and black(README) Mobula banners.")


if __name__ == "__main__":
    main()

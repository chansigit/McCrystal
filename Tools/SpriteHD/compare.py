"""Flipbook an animation four ways, to answer the only question stills cannot.

Shimmer -- the same walk cycle upscaled into eight mutually inconsistent sets of
detail -- is invisible in a still and obvious in motion, so every still comparison
is blind to the failure mode that decides this project.  This renders the cycle at
its own frame interval as an animated GIF, with the panels aligned on the frame
anchor so the only differences are the ones under test.

    python3 Tools/SpriteHD/compare.py --library Monster/004 --action Walking \
        --direction 2 --out /tmp/deer

Panels, left to right:
    source        what the browser draws today: one source pixel per 2x2 physical
    dedithered    the shadow fix alone, still nearest neighbour
    xBRZ          the proposal, on nearest-neighbour ground
    xBRZ + ground the same with the ground upscaled too, which is the question of
                  whether a sharp monster on blocky grass reads as wrong
"""

import argparse
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import xbrz
from mirlib import Library
from prepass import dedither_shadows, zero_transparent

CELL_WIDTH, CELL_HEIGHT = 48, 32  # GameScene.cs:10294, world.js:572
GRASS = [120, 121, 122, 123, 124, 125, 126]  # SmTiles.Lib, picked by mean hue
SCALE = 2  # the Retina factor the canvas already has: world.js:58


def nearest(rgba, factor=SCALE):
    return np.repeat(np.repeat(rgba, factor, axis=0), factor, axis=1)


def ground(width, height, tiles, upscaled):
    """Tile the panel with grass, at 2x either by pixel doubling or by xBRZ."""
    cells = [tiles.rgba(i) for i in GRASS]
    cells = xbrz.scale(cells) if upscaled else [nearest(c) for c in cells]
    tile_w, tile_h = CELL_WIDTH * SCALE, CELL_HEIGHT * SCALE
    canvas = np.zeros((height, width, 4), np.uint8)
    for row in range((height + tile_h - 1) // tile_h):
        for column in range((width + tile_w - 1) // tile_w):
            cell = cells[(row * 3 + column * 5) % len(cells)]
            top, left = row * tile_h, column * tile_w
            piece = cell[:height - top, :width - left]
            canvas[top:top + piece.shape[0], left:left + piece.shape[1]] = piece
    canvas[..., 3] = 255
    return canvas


def over(background, sprite, left, top):
    """Composite one RGBA sprite onto an opaque background, in place."""
    height, width = sprite.shape[:2]
    top, left = max(top, 0), max(left, 0)
    height = min(height, background.shape[0] - top)
    width = min(width, background.shape[1] - left)
    if height <= 0 or width <= 0:
        return
    patch = sprite[:height, :width]
    alpha = (patch[..., 3:4].astype(np.float32)) / 255.0
    target = background[top:top + height, left:left + width]
    target[..., :3] = (patch[..., :3] * alpha + target[..., :3] * (1 - alpha)).astype(np.uint8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="Build/Client/Debug/Data")
    parser.add_argument("--library", default="Monster/004")
    parser.add_argument("--action", default="Walking")
    parser.add_argument("--direction", type=int, default=2)
    parser.add_argument("--out", required=True)
    parser.add_argument("--fps-divisor", type=float, default=1.0,
                        help="slow the flipbook down; shimmer is easier to see at 0.5x")
    parser.add_argument("--zoom", type=int, default=1,
                        help="magnify the finished sheet by nearest neighbour, for detail")
    args = parser.parse_args()

    data = Path(args.data)
    library = Library(data / f"{args.library}.Lib")
    tiles = Library(data / "Map/WemadeMir2/SmTiles.Lib")

    animation = library.animations[args.action]
    stride = animation.count + animation.skip
    indices = [animation.start + args.direction * stride + step for step in range(animation.count)]

    raw = [library.rgba(i) for i in indices]
    prepared = [dedither_shadows(zero_transparent(f))[0] for f in raw]
    upscaled = xbrz.scale(prepared)

    # One canvas for the whole cycle, sized from the frame anchors so the deer sits
    # still between frames exactly as the game draws it.
    boxes = [(library.frames[i].x, library.frames[i].y,
              library.frames[i].x + f.shape[1], library.frames[i].y + f.shape[0])
             for i, f in zip(indices, raw)]
    left = min(b[0] for b in boxes) - 8
    top = min(b[1] for b in boxes) - 8
    width = max(b[2] for b in boxes) + 8 - left
    height = max(b[3] for b in boxes) + 8 - top

    panel_w, panel_h = width * SCALE, height * SCALE
    label_h = 18
    variants = [
        ("source", [nearest(f) for f in raw], False),
        ("dedithered", [nearest(f) for f in prepared], False),
        ("xBRZ", upscaled, False),
        ("xBRZ + ground", upscaled, True),
    ]
    grounds = [ground(panel_w, panel_h, tiles, up) for _, _, up in variants]

    pages = []
    for step in range(animation.count):
        sheet = np.zeros((panel_h + label_h, panel_w * len(variants), 4), np.uint8)
        sheet[..., 3] = 255
        for column, ((_, sprites, _), base) in enumerate(zip(variants, grounds)):
            panel = base.copy()
            frame = library.frames[indices[step]]
            over(panel, sprites[step], (frame.x - left) * SCALE, (frame.y - top) * SCALE)
            sheet[label_h:, column * panel_w:(column + 1) * panel_w] = panel
        if args.zoom > 1:
            sheet = np.repeat(np.repeat(sheet, args.zoom, axis=0), args.zoom, axis=1)
        page = Image.fromarray(sheet[..., :3], "RGB")
        draw = ImageDraw.Draw(page)
        for column, (name, _, _) in enumerate(variants):
            draw.text((column * panel_w * args.zoom + 6, 4), name, fill=(230, 230, 230))
        pages.append(page)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    delay = int(animation.interval / args.fps_divisor)
    pages[0].save(f"{out}.png")

    # Pillow's own GIF writer quantises each page separately, which adds its own
    # dithering on top of the art -- the one artefact this comparison must not
    # invent.  ffmpeg builds one palette for the whole sequence instead.
    with tempfile.TemporaryDirectory() as scratch:
        for number, page in enumerate(pages):
            page.save(Path(scratch) / f"{number:04d}.png")
        rate = 1000 / delay
        common = ["-framerate", f"{rate}", "-i", f"{scratch}/%04d.png"]
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *common,
                        "-vf", "palettegen=stats_mode=full", f"{scratch}/palette.png"], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *common, "-i", f"{scratch}/palette.png",
                        "-lavfi", "paletteuse=dither=none", "-loop", "0", f"{out}.gif"], check=True)
    print(f"{out}.gif  {len(pages)} frames at {delay} ms, {pages[0].width}x{pages[0].height}")
    print(f"{out}.png  first frame")


if __name__ == "__main__":
    main()

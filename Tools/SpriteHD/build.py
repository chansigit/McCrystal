"""Build the HD override set for one or more libraries.

Writes `Data/HD/<library>/<index>.png` at exactly twice the source size. The
gateway serves those in place of the decoded `.Lib` frame and the renderer draws
them at half scale, so the sprite keeps its on-screen size and its anchor while
gaining one texture pixel per physical pixel on a Retina canvas.

Exactly twice the size, with no cropping, is the whole trick: it means no offset
is ever recomputed, and the doubling landmine in the research doc cannot fire.
The original `.Lib` files are never touched, and deleting `Data/HD` reverts
everything.

    python3 Tools/SpriteHD/build.py --library Monster/004 Monster/068
    python3 Tools/SpriteHD/build.py --all-monsters
"""

import argparse
import io
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))

import xbrz
from mirlib import Library
from prepass import dedither_shadows, zero_transparent

BATCH = 256  # frames per xBRZ round trip, to bound peak memory

# Measured over 60 Zuma Taurus frames: PNG at optimize=True costs 30x the encode
# time of compress_level=6 and saves 1.3%. Lossless WebP is 68% of the size but
# 40x the time, which across 1.87M frames is a day and a half, so it stays opt-in.
ENCODERS = {
    "png": ("PNG", dict(optimize=False, compress_level=6)),
    "png-small": ("PNG", dict(optimize=True)),
    "webp": ("WEBP", dict(lossless=True, quality=100, method=4)),
}


def convert(library_path, out_dir, factor=2, dedither=True, encoding="png"):
    fmt, options = ENCODERS[encoding]
    suffix = "webp" if fmt == "WEBP" else "png"
    library = Library(library_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = filled = 0
    pending = []

    def flush():
        nonlocal written
        if not pending:
            return
        indices = [index for index, _ in pending]
        scaled = xbrz.scale([frame for _, frame in pending], factor)
        for index, frame in zip(indices, scaled):
            buffer = io.BytesIO()
            Image.fromarray(frame, "RGBA").save(buffer, fmt, **options)
            (out_dir / f"{index}.{suffix}").write_bytes(buffer.getvalue())
            written += 1
        pending.clear()

    for index, frame in enumerate(library.frames):
        if frame is None:
            continue
        if frame.has_mask:
            # A second layer would have to be scaled and re-attached identically;
            # 120 frames in the whole corpus have one, so they stay at 1x.
            continue
        rgba = zero_transparent(library.rgba(index))
        if dedither:
            rgba, gaps = dedither_shadows(rgba)
            filled += gaps
        pending.append((index, rgba))
        if len(pending) >= BATCH:
            flush()
    flush()
    return written, filled


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="Build/Client/Debug/Data")
    parser.add_argument("--library", nargs="*", default=[])
    parser.add_argument("--all-monsters", action="store_true")
    parser.add_argument("--monster-range", nargs=2, type=int, metavar=("LOW", "HIGH"),
                        help="monster library numbers to convert, inclusive")
    parser.add_argument("--factor", type=int, default=2)
    parser.add_argument("--no-dedither", action="store_true")
    parser.add_argument("--encoding", choices=sorted(ENCODERS), default="png")
    args = parser.parse_args()

    data = Path(args.data)
    names = list(args.library)
    if args.all_monsters:
        names += sorted(f"Monster/{p.stem}" for p in (data / "Monster").glob("*.[Ll]ib"))
    if args.monster_range:
        low, high = args.monster_range
        names += sorted(f"Monster/{p.stem}" for p in (data / "Monster").glob("*.[Ll]ib")
                        if p.stem.isdigit() and low <= int(p.stem) <= high)
    if not names:
        raise SystemExit("nothing to do: pass --library or --all-monsters")

    started = time.time()
    total = 0
    for name in names:
        source = data / f"{name}.Lib"
        if not source.exists():
            print(f"missing {source}", file=sys.stderr)
            continue
        written, filled = convert(source, data / "HD" / name, args.factor,
                                  not args.no_dedither, args.encoding)
        total += written
        print(f"{name:20} {written:6} frames, {filled:8} shadow gaps filled")
    print(f"{total} frames in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()

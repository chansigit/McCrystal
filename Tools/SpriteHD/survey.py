"""Corpus-wide numbers for the upscaling plan, measured rather than estimated.

Header fields are read for every frame in every library, which is fast because it
needs no decompression. The dither and alpha statistics need real pixels, so those
come from a deterministic random sample.

    python3 Tools/SpriteHD/survey.py --sample 4000
"""

import argparse
import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from mirlib import Library
from prepass import find_dither_colours, zero_transparent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="Build/Client/Debug/Data")
    parser.add_argument("--sample", type=int, default=4000)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    paths = sorted(Path(args.data).rglob("*.[Ll]ib"))
    libraries = frames = masks = 0
    pixels = mask_pixels = compressed = 0
    by_group = Counter()
    catalogue = []

    for path in paths:
        try:
            library = Library(path)
        except Exception as error:              # a handful of libraries are stubs
            print(f"skipped {path.name}: {error}", file=sys.stderr)
            continue
        libraries += 1
        group = path.relative_to(args.data).parts[0] if len(path.relative_to(args.data).parts) > 1 else "root"
        for index, frame in enumerate(library.frames):
            if frame is None:
                continue
            frames += 1
            pixels += frame.width * frame.height
            compressed += frame.length
            by_group[group] += frame.width * frame.height
            if frame.has_mask:
                masks += 1
                mask_pixels += frame.mask_width * frame.mask_height
                compressed += frame.mask_length
            catalogue.append((path, index))

    print(f"libraries      {libraries}")
    print(f"frames         {frames}")
    print(f"pixels         {pixels / 1e9:.2f} Gpx   -> {pixels * 4 / 1e9:.2f} Gpx at 2x")
    print(f"compressed     {compressed / 2**30:.2f} GiB on disk")
    print(f"masked frames  {masks} ({masks / max(frames, 1) * 100:.2f}%), {mask_pixels / 1e6:.1f} Mpx")
    print("largest groups by pixels:")
    for group, count in by_group.most_common(8):
        print(f"  {group:16} {count / 1e9:6.2f} Gpx  {count / pixels * 100:5.1f}%")

    random.seed(args.seed)
    sample = random.sample(catalogue, min(args.sample, len(catalogue)))
    opened = None
    counted = dithered = transparent = opaque = hidden = semi = 0
    per_group = Counter()
    per_group_total = Counter()
    for path, index in sorted(sample):
        if opened is None or opened.path != path:
            opened = Library(path)
        parts = path.relative_to(args.data).parts
        group = parts[0] if len(parts) > 1 else "root"
        # The hidden-colour count must be taken before the loader's rule rewrites
        # the alpha it is counting.
        raw = opened.rgba(index, apply_client_rule=False)
        if raw is None:
            continue
        counted += 1
        alpha = raw[..., 3]
        hidden += int(((alpha == 0) & (raw[..., :3].any(axis=2))).sum())
        transparent += int((alpha == 0).sum())
        opaque += int((alpha == 255).sum())
        semi += int(((alpha > 0) & (alpha < 255)).sum())
        per_group_total[group] += 1
        if find_dither_colours(zero_transparent(opened.rgba(index))):
            dithered += 1
            per_group[group] += 1
    total = transparent + opaque + semi
    print(f"\nsample of {counted} frames")
    print(f"  frames carrying a dither region  {dithered} ({dithered / max(counted, 1) * 100:.1f}%)")
    print(f"  transparent pixels               {transparent / max(total, 1) * 100:.1f}%")
    print(f"  semi-transparent pixels          {semi / max(total, 1) * 100:.4f}%")
    print(f"  transparent but carrying colour  {hidden} ({hidden / max(total, 1) * 100:.4f}%)"
          f"  <- the loader would force these opaque")
    print("  dither share by group:")
    for group, seen in per_group_total.most_common(10):
        print(f"    {group:16} {per_group[group]:5}/{seen:<5} {per_group[group] / seen * 100:5.1f}%")


if __name__ == "__main__":
    main()

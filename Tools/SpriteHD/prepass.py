"""Pre-passes that must run before a frame is upscaled.

The order and the reasons are in docs/sprite-upscaling-research.md.  Two of these
silently ruin the result if skipped: zeroing the RGB of transparent pixels, and
doubling the frame offsets on re-import (which lives in the importer, not here).
"""

import numpy as np

# A dither colour has to cover enough pixels for the parity test to mean anything,
# and has to sit almost entirely on one parity.  Measured shares on real frames are
# 92-97% of a colour's pixels on one parity once the body's own dark pixels are
# excluded by grouping on the exact colour.
MIN_DITHER_PIXELS = 32
PARITY_SHARE = 0.90
SHADOW_ALPHA = 128


def zero_transparent(rgba):
    """Drop the colour hiding under alpha 0.

    Every frame carries pixels that are transparent but keep colour data, a
    leftover of DirectX ignoring alpha.  Upscalers faithfully quadruple them, and
    the client's own loader then forces `a == 0 && rgb != 0` to `a = 255` -- so if
    this is skipped the whole hidden backdrop turns opaque as a full-frame halo.
    Verified: with this pass the leak is exactly 0 pixels, without it, 192 of 256.
    """
    out = rgba.copy()
    out[out[..., 3] == 0, :3] = 0
    return out


def find_dither_colours(rgba):
    """Colours laid down on one parity of `(x + y) % 2` only -- fake 50% opacity."""
    opaque = rgba[..., 3] == 255
    ys, xs = np.nonzero(opaque)
    if len(ys) == 0:
        return []
    parity = (ys + xs) & 1
    colours = rgba[ys, xs, :3]
    keys = (colours[:, 0].astype(np.int32) << 16) | (colours[:, 1].astype(np.int32) << 8) | colours[:, 2]
    found = []
    for key in np.unique(keys):
        rows = keys == key
        total = int(rows.sum())
        if total < MIN_DITHER_PIXELS:
            continue
        ones = int(parity[rows].sum())
        share = max(ones, total - ones) / total
        if share >= PARITY_SHARE:
            found.append((
                (int(key >> 16), int((key >> 8) & 0xFF), int(key & 0xFF)),
                1 if ones * 2 > total else 0, total, share))
    return found


def dedither_shadows(rgba):
    """Replace each checkerboard region with a solid one at half alpha.

    xBRZ reads the checkerboard as diagonal geometry and turns the shadow into
    lumpy blobs with round holes, so this has to happen first.  It also produces a
    better shadow than the 1999 engine could draw, which is worth having on its own.
    """
    out = rgba.copy()
    filled = 0
    for colour, parity, _total, _share in find_dither_colours(rgba):
        mask = np.all(out[..., :3] == colour, axis=2) & (out[..., 3] == 255)
        # A gap belongs to the shadow when it is transparent, on the other parity,
        # and flanked by the dither on at least two sides -- true everywhere inside
        # the region, false at its corners.
        neighbours = np.zeros(mask.shape, np.uint8)
        neighbours[1:, :] += mask[:-1, :]
        neighbours[:-1, :] += mask[1:, :]
        neighbours[:, 1:] += mask[:, :-1]
        neighbours[:, :-1] += mask[:, 1:]
        ys, xs = np.indices(mask.shape)
        gaps = (out[..., 3] == 0) & (((ys + xs) & 1) != parity) & (neighbours >= 2)
        region = mask | gaps
        out[region, 0], out[region, 1], out[region, 2] = colour
        out[region, 3] = SHADOW_ALPHA
        filled += int(gaps.sum())
    return out, filled


def crop(rgba):
    """Trim to the visible bounding box, returning the offset it was moved by.

    61.8% of all pixels in the corpus are transparent padding, and the offset this
    returns is added to the frame's own anchor, which is itself a cropped origin.
    """
    visible = rgba[..., 3] > 0
    if not visible.any():
        return rgba[:0, :0], 0, 0
    ys, xs = np.nonzero(visible)
    top, bottom = int(ys.min()), int(ys.max()) + 1
    left, right = int(xs.min()), int(xs.max()) + 1
    return rgba[top:bottom, left:right], left, top

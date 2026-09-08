"""Pre-passes that must run before a frame is upscaled.

The order and the reasons are in docs/sprite-upscaling-research.md.  Two of these
silently ruin the result if skipped: zeroing the RGB of transparent pixels, and
doubling the frame offsets on re-import (which lives in the importer, not here).
"""

import numpy as np

# A region has to cover enough pixels before its checkerboard geometry means
# anything rather than being incidental speckle in the anti-aliasing.
MIN_DITHER_PIXELS = 32

# A real checkerboard is self-supporting: each of its pixels is surrounded
# diagonally by more of the same checkerboard. A dithered gradient -- the falloff
# around a flame, which this art also draws by stippling -- only strands isolated
# pixels, which support each other much more weakly. Measured:
#
#   deer shadow          98.9%      flame ramp (8,0,0)     32.4%
#   Monster/075 shadow   96.9%      flame ramp (40,0,0)    43.5%
#   Monster/314 shadow   99.1%      flame ramp (248,116,0) 26.2%
#
# This is deliberately a local test. The obvious global ones -- what share of a
# colour's pixels sit on one parity, or in the checkerboard -- both collapse when a
# body reuses the shadow colour as an ordinary dark tone, which is how Monster/075's
# shadow was missed in the first place. Monster/075 scores 62% on the global test
# and 96.9% on this one.
SELF_SUPPORT = 0.75

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


def _neighbours(mask):
    """Counts of a mask's own pixels in the 4 orthogonal and 4 diagonal directions."""
    orthogonal = np.zeros(mask.shape, np.uint8)
    orthogonal[1:, :] += mask[:-1, :]
    orthogonal[:-1, :] += mask[1:, :]
    orthogonal[:, 1:] += mask[:, :-1]
    orthogonal[:, :-1] += mask[:, 1:]
    diagonal = np.zeros(mask.shape, np.uint8)
    diagonal[1:, 1:] += mask[:-1, :-1]
    diagonal[1:, :-1] += mask[:-1, 1:]
    diagonal[:-1, 1:] += mask[1:, :-1]
    diagonal[:-1, :-1] += mask[1:, 1:]
    return orthogonal, diagonal


def dither_mask(rgba, colour):
    """The pixels of one colour that sit in a checkerboard rather than a solid area.

    Parity is the wrong test. It is a global statistic, and a monster whose body
    uses the shadow colour as an ordinary dark tone dilutes it below any usable
    threshold -- `Monster/075.Lib` reads 80-88% and its shadow was missed entirely.

    The checkerboard is a local property, so read it locally. A pixel inside a
    dither has all four diagonal neighbours in the same colour and none of its four
    orthogonal ones; a pixel inside a solid region of that colour has both. That
    separates the two even when they are the same colour in the same frame, and it
    needs no threshold at all.
    """
    mask = np.all(rgba[..., :3] == colour, axis=2) & (rgba[..., 3] == 255)
    if not mask.any():
        return mask
    orthogonal, diagonal = _neighbours(mask)
    return mask & (diagonal >= 2) & (orthogonal == 0)


def self_support(mask):
    """The share of a mask's pixels that are themselves surrounded by the mask."""
    if not mask.any():
        return 0.0
    _, diagonal = _neighbours(mask)
    return float((mask & (diagonal >= 2)).sum()) / float(mask.sum())


def find_dither_colours(rgba):
    """Colours that fake 50% opacity by covering only one parity of a region."""
    opaque = rgba[..., 3] == 255
    if not opaque.any():
        return []
    colours = rgba[opaque][:, :3]
    keys = (colours[:, 0].astype(np.int32) << 16) | (colours[:, 1].astype(np.int32) << 8) | colours[:, 2]
    found = []
    for key, total in zip(*np.unique(keys, return_counts=True)):
        if total < MIN_DITHER_PIXELS:
            continue
        colour = (int(key >> 16), int((key >> 8) & 0xFF), int(key & 0xFF))
        mask = dither_mask(rgba, colour)
        count = int(mask.sum())
        if count >= MIN_DITHER_PIXELS and self_support(mask) >= SELF_SUPPORT:
            found.append((colour, count, int(total)))
    return found


def dedither_shadows(rgba):
    """Replace each checkerboard region with a solid one at half alpha.

    xBRZ reads the checkerboard as diagonal geometry and turns the shadow into
    lumpy blobs with round holes, so this has to happen first.  It also produces a
    better shadow than the 1999 engine could draw, which is worth having on its own.
    """
    out = rgba.copy()
    filled = 0
    for colour, _count, _total in find_dither_colours(rgba):
        mask = dither_mask(out, colour)
        # A gap belongs to the shadow when it is transparent and flanked by the
        # dither on at least two sides -- true everywhere inside the region, false
        # at its corners, and it never reaches a pixel the body owns.
        orthogonal, _ = _neighbours(mask)
        gaps = (out[..., 3] == 0) & (orthogonal >= 2)
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

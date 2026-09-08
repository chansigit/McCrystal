"""python3 -m unittest discover -s Tools/SpriteHD"""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from prepass import crop, dedither_shadows, dither_mask, find_dither_colours, zero_transparent

SHADOW = (16, 8, 8)


def canvas(width, height):
    return np.zeros((height, width, 4), np.uint8)


def checkerboard(image, colour, box, parity=0):
    left, top, right, bottom = box
    for y in range(top, bottom):
        for x in range(left, right):
            if (x + y) % 2 == parity:
                image[y, x, :3] = colour
                image[y, x, 3] = 255


def solid(image, colour, box):
    left, top, right, bottom = box
    image[top:bottom, left:right, :3] = colour
    image[top:bottom, left:right, 3] = 255


class DitherDetection(unittest.TestCase):
    def test_a_checkerboard_of_one_colour_is_a_shadow(self):
        image = canvas(24, 24)
        checkerboard(image, SHADOW, (2, 2, 18, 18))
        self.assertEqual([c for c, _, _ in find_dither_colours(image)], [SHADOW])

    def test_a_solid_region_of_the_same_colour_is_not(self):
        image = canvas(24, 24)
        solid(image, SHADOW, (2, 2, 18, 18))
        self.assertEqual(find_dither_colours(image), [])

    def test_the_body_may_use_the_shadow_colour_without_hiding_it(self):
        # Monster/075.Lib does exactly this, and a global parity test reads 80-88%
        # on it and misses the shadow entirely. Local geometry does not care.
        image = canvas(48, 24)
        checkerboard(image, SHADOW, (2, 2, 22, 22))
        solid(image, SHADOW, (26, 2, 46, 22))
        colours = find_dither_colours(image)
        self.assertEqual([c for c, _, _ in colours], [SHADOW])
        mask = dither_mask(image, SHADOW)
        self.assertFalse(mask[:, 26:].any())  # the solid half stays solid
        self.assertTrue(mask[:, :24].any())

    def test_either_parity_is_a_shadow(self):
        # The parity flips between frames of one walk cycle, so it can never be
        # assumed once and reused.
        for parity in (0, 1):
            image = canvas(24, 24)
            checkerboard(image, SHADOW, (2, 2, 18, 18), parity)
            self.assertEqual([c for c, _, _ in find_dither_colours(image)], [SHADOW], parity)

    def test_a_gradient_fringe_is_left_alone(self):
        # A flame's falloff is stippled too, but it thins out rather than holding a
        # clean checkerboard, so its stranded pixels barely support each other:
        # Monster/314's ramps score 26-44% against 97-99% for a real shadow.
        # Flattening a flame to half alpha would be a visible regression.
        image = canvas(64, 64)
        solid(image, (248, 116, 0), (0, 0, 64, 40))
        for y in range(40, 60):
            step = 2 + (y - 40) // 3          # the ramp thins with distance
            for x in range(0, 64, step):
                if (x + y) % 2 == 0:
                    image[y, x, :3] = (248, 116, 0)
                    image[y, x, 3] = 255
        self.assertEqual(find_dither_colours(image), [])

    def test_a_clean_checkerboard_below_a_solid_block_is_still_a_shadow(self):
        # The share of the colour that is dithered says nothing: Monster/075's real
        # shadow is only 62% of its colour's pixels and Monster/314's is 60%.
        image = canvas(64, 64)
        solid(image, SHADOW, (0, 0, 64, 40))
        checkerboard(image, SHADOW, (0, 40, 64, 60))
        self.assertEqual([c for c, _, _ in find_dither_colours(image)], [SHADOW])

    def test_speckle_is_below_the_size_floor(self):
        image = canvas(24, 24)
        checkerboard(image, SHADOW, (2, 2, 8, 8))
        self.assertEqual(find_dither_colours(image), [])


class Filling(unittest.TestCase):
    def test_the_region_becomes_solid_at_half_alpha(self):
        image = canvas(24, 24)
        checkerboard(image, SHADOW, (2, 2, 18, 18))
        out, filled = dedither_shadows(image)
        self.assertGreater(filled, 100)
        interior = out[6:14, 6:14]
        self.assertTrue(np.all(interior[..., 3] == 128))
        self.assertTrue(np.all(interior[..., :3] == SHADOW))
        self.assertEqual(find_dither_colours(out), [])

    def test_nothing_opaque_is_overwritten(self):
        image = canvas(48, 24)
        checkerboard(image, SHADOW, (2, 2, 22, 22))
        solid(image, (200, 30, 30), (10, 10, 20, 20))
        out, _ = dedither_shadows(image)
        body = np.all(image[..., :3] == (200, 30, 30), axis=2) & (image[..., 3] == 255)
        self.assertTrue(np.all(out[body, 3] == 255))
        self.assertTrue(np.all(out[body, :3] == (200, 30, 30)))


class Alpha(unittest.TestCase):
    def test_colour_hiding_under_alpha_zero_is_dropped(self):
        # Without this the client's own `a == 0 && rgb != 0 -> a = 255` rule turns
        # the whole hidden backdrop opaque after upscaling.
        image = canvas(8, 8)
        image[..., :3] = (255, 0, 0)
        image[2:6, 2:6] = (0, 200, 0, 255)
        out = zero_transparent(image)
        self.assertFalse(((out[..., 3] == 0) & out[..., :3].any(axis=2)).any())
        self.assertTrue(np.all(out[2:6, 2:6, :3] == (0, 200, 0)))

    def test_crop_reports_where_it_moved_the_frame(self):
        image = canvas(20, 20)
        solid(image, SHADOW, (5, 7, 9, 11))
        cropped, left, top = crop(image)
        self.assertEqual((cropped.shape[1], cropped.shape[0]), (4, 4))
        self.assertEqual((left, top), (5, 7))


if __name__ == "__main__":
    unittest.main()

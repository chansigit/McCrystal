"""Reader for the .Lib v3 sprite libraries under Data/.

Mirrors Client.Web/GameAssets.cs, which is itself Client/MirGraphics/MLibrary.cs:
a header, a table of frame offsets, then per frame a 17-byte descriptor followed
by gzip-compressed BGRA.  The client's `a == 0 && rgb != 0 -> a = 255` rule is
applied here, at decode, because every pre-pass downstream depends on alpha
already being canonical (docs/sprite-upscaling-research.md).
"""

import gzip
import struct
from dataclasses import dataclass

import numpy as np

# Client/MirObjects/MirAction is a byte on the stream; only the names the tools
# below need are listed, the rest print as their number.
ACTIONS = {
    0: "Standing", 1: "Walking", 2: "Running", 3: "Pushing", 4: "DashL",
    5: "DashR", 6: "Stance", 7: "Stance2", 8: "Attack1", 9: "Attack2",
    10: "Attack3", 11: "Attack4", 12: "AttackRange1", 13: "AttackRange2",
    14: "AttackRange3", 15: "Spell", 16: "Harvest", 17: "Struck", 18: "Die",
    19: "Dead", 20: "Skeleton", 21: "Revive", 22: "Show", 23: "Hide",
}


@dataclass
class Frame:
    width: int
    height: int
    x: int
    y: int
    shadow_x: int
    shadow_y: int
    shadow: int
    position: int
    length: int
    # A frame can carry a second image layer, flagged by the top bit of the shadow
    # byte (Client/MirGraphics/MLibrary.cs:892).  It has to be upscaled with
    # identical settings or the two layers desynchronise.
    mask_width: int = 0
    mask_height: int = 0
    mask_x: int = 0
    mask_y: int = 0
    mask_position: int = 0
    mask_length: int = 0

    @property
    def has_mask(self):
        return self.shadow >> 7 == 1


@dataclass
class Animation:
    start: int
    count: int
    skip: int
    interval: int
    reverse: bool
    blend: bool


class Library:
    def __init__(self, path):
        self.path = path
        self.blob = open(path, "rb").read()
        version, count = struct.unpack_from("<ii", self.blob, 0)
        if version not in (2, 3):
            raise ValueError(f"unsupported library version {version}")
        offset = 8
        animation_position = 0
        if version >= 3:
            animation_position = struct.unpack_from("<i", self.blob, offset)[0]
            offset += 4
        positions = struct.unpack_from(f"<{count}i", self.blob, offset)

        self.frames = []
        for position in positions:
            if position <= 0 or position + 17 > len(self.blob):
                self.frames.append(None)
                continue
            w, h, x, y, sx, sy = struct.unpack_from("<6h", self.blob, position)
            shadow = self.blob[position + 12]
            length = struct.unpack_from("<i", self.blob, position + 13)[0]
            if w <= 0 or h <= 0 or w > 4096 or h > 4096 or length <= 0:
                self.frames.append(None)
                continue
            frame = Frame(w, h, x, y, sx, sy, shadow, position + 17, length)
            if frame.has_mask:
                at = frame.position + length
                mw, mh, mx, my = struct.unpack_from("<4h", self.blob, at)
                mask_length = struct.unpack_from("<i", self.blob, at + 8)[0]
                frame.mask_width, frame.mask_height = mw, mh
                frame.mask_x, frame.mask_y = mx, my
                frame.mask_position, frame.mask_length = at + 12, mask_length
            self.frames.append(frame)

        self.animations = {}
        if animation_position > 0:
            at = animation_position
            (animation_count,) = struct.unpack_from("<i", self.blob, at)
            at += 4
            for _ in range(animation_count):
                action = self.blob[at]
                at += 1
                start, count_, skip, interval = struct.unpack_from("<4i", self.blob, at)
                at += 16 + 16  # four unused ints follow
                reverse, blend = self.blob[at], self.blob[at + 1]
                at += 2
                name = ACTIONS.get(action, str(action))
                self.animations[name] = Animation(start, count_, skip, interval,
                                                  bool(reverse), bool(blend))

    def __len__(self):
        return len(self.frames)

    def _decode(self, position, length, width, height, apply_client_rule=True):
        raw = gzip.decompress(self.blob[position:position + length])
        pixels = np.frombuffer(raw, np.uint8, width * height * 4)
        bgra = pixels.reshape(height, width, 4).copy()
        if apply_client_rule:
            hidden = (bgra[..., 3] == 0) & (bgra[..., :3].any(axis=2))
            bgra[hidden, 3] = 255
        return bgra[..., [2, 1, 0, 3]]

    def rgba(self, index, apply_client_rule=True):
        """Decode one frame to an (h, w, 4) uint8 RGBA array, or None.

        `apply_client_rule` is the loader's `a == 0 && rgb != 0 -> a = 255`
        (Client/MirGraphics/MLibrary.cs). Every pipeline wants it on; measuring how
        many pixels it actually touches is the one reason to turn it off.
        """
        frame = self.frames[index]
        if frame is None:
            return None
        return self._decode(frame.position, frame.length, frame.width, frame.height,
                            apply_client_rule)

    def mask_rgba(self, index):
        """Decode a frame's second layer, or None when it has none."""
        frame = self.frames[index]
        if frame is None or not frame.has_mask or frame.mask_length <= 0:
            return None
        return self._decode(frame.mask_position, frame.mask_length,
                            frame.mask_width, frame.mask_height)

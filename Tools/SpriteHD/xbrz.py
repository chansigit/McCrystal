"""Drive the xBRZ WASM scaler through one long-lived node process."""

import struct
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent


def scale(frames, factor=2):
    """frames: list of (h, w, 4) uint8 RGBA -> list of the same, `factor` times larger."""
    if not frames:
        return []
    payload = [struct.pack("<i", len(frames))]
    for frame in frames:
        payload.append(struct.pack("<ii", frame.shape[1], frame.shape[0]))
        payload.append(np.ascontiguousarray(frame, np.uint8).tobytes())
    result = subprocess.run(["node", str(HERE / "xbrz.mjs"), str(factor)],
                            input=b"".join(payload), stdout=subprocess.PIPE, check=True).stdout

    count = struct.unpack_from("<i", result, 0)[0]
    at, out = 4, []
    for _ in range(count):
        width, height = struct.unpack_from("<ii", result, at)
        at += 8
        size = width * height * 4
        frame = np.frombuffer(result, np.uint8, size, at).reshape(height, width, 4).copy()
        at += size
        # Belt and braces for the client's `a == 0 && rgb != 0 -> a = 255` rule: the
        # pre-pass already drives this to zero, so this only guards against a frame
        # reaching here unprepared.
        frame[frame[..., 3] == 0, :3] = 0
        out.append(frame)
    return out

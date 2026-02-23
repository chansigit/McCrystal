"""
.NET-compatible BinaryReader/BinaryWriter for the Crystal game protocol.

Supports all .NET primitive types used in packets, including the 7-bit
encoded integer length prefix for strings.
"""

import io
import struct


class BinaryReader:
    """Read .NET BinaryWriter-format data from a bytes buffer."""

    def __init__(self, data: bytes):
        self._stream = io.BytesIO(data)

    # -- primitives --

    def read_byte(self) -> int:
        return struct.unpack("<B", self._stream.read(1))[0]

    def read_sbyte(self) -> int:
        return struct.unpack("<b", self._stream.read(1))[0]

    def read_bool(self) -> bool:
        return self.read_byte() != 0

    def read_int16(self) -> int:
        return struct.unpack("<h", self._stream.read(2))[0]

    def read_uint16(self) -> int:
        return struct.unpack("<H", self._stream.read(2))[0]

    def read_int32(self) -> int:
        return struct.unpack("<i", self._stream.read(4))[0]

    def read_uint32(self) -> int:
        return struct.unpack("<I", self._stream.read(4))[0]

    def read_int64(self) -> int:
        return struct.unpack("<q", self._stream.read(8))[0]

    def read_uint64(self) -> int:
        return struct.unpack("<Q", self._stream.read(8))[0]

    def read_single(self) -> float:
        return struct.unpack("<f", self._stream.read(4))[0]

    def read_bytes(self, count: int) -> bytes:
        return self._stream.read(count)

    # -- .NET 7-bit encoded length-prefixed string --

    def _read_7bit_int(self) -> int:
        """Decode a .NET 7-bit encoded integer (variable-length)."""
        result = 0
        shift = 0
        while True:
            b = self.read_byte()
            result |= (b & 0x7F) << shift
            if (b & 0x80) == 0:
                break
            shift += 7
        return result

    def read_string(self) -> str:
        length = self._read_7bit_int()
        if length == 0:
            return ""
        return self.read_bytes(length).decode("utf-8")

    # -- helpers --

    @property
    def remaining(self) -> int:
        pos = self._stream.tell()
        self._stream.seek(0, 2)
        end = self._stream.tell()
        self._stream.seek(pos)
        return end - pos


class BinaryWriter:
    """Write .NET BinaryReader-compatible data to a bytes buffer."""

    def __init__(self):
        self._stream = io.BytesIO()

    # -- primitives --

    def write_byte(self, value: int):
        self._stream.write(struct.pack("<B", value & 0xFF))

    def write_sbyte(self, value: int):
        self._stream.write(struct.pack("<b", value))

    def write_bool(self, value: bool):
        self.write_byte(1 if value else 0)

    def write_int16(self, value: int):
        self._stream.write(struct.pack("<h", value))

    def write_uint16(self, value: int):
        self._stream.write(struct.pack("<H", value & 0xFFFF))

    def write_int32(self, value: int):
        self._stream.write(struct.pack("<i", value))

    def write_uint32(self, value: int):
        self._stream.write(struct.pack("<I", value & 0xFFFFFFFF))

    def write_int64(self, value: int):
        self._stream.write(struct.pack("<q", value))

    def write_uint64(self, value: int):
        self._stream.write(struct.pack("<Q", value & 0xFFFFFFFFFFFFFFFF))

    def write_single(self, value: float):
        self._stream.write(struct.pack("<f", value))

    def write_bytes(self, data: bytes):
        self._stream.write(data)

    # -- .NET 7-bit encoded length-prefixed string --

    @staticmethod
    def _encode_7bit_int(value: int) -> bytes:
        result = bytearray()
        while value >= 0x80:
            result.append((value & 0x7F) | 0x80)
            value >>= 7
        result.append(value & 0x7F)
        return bytes(result)

    def write_string(self, value: str):
        encoded = value.encode("utf-8")
        self.write_bytes(self._encode_7bit_int(len(encoded)))
        self.write_bytes(encoded)

    # -- output --

    def to_bytes(self) -> bytes:
        return self._stream.getvalue()

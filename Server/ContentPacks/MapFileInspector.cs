using System.Buffers.Binary;

namespace Server.ContentPacks
{
    public sealed class MapFileInspection
    {
        public string Format { get; init; }
        public int Width { get; init; }
        public int Height { get; init; }
        public long ActualBytes { get; init; }
        public long RequiredBytes { get; init; }
        public string Error { get; init; }
        public bool IsValid => Error == null;
    }

    public static class MapFileInspector
    {
        public static MapFileInspection Inspect(string path)
        {
            try
            {
                using var stream = File.OpenRead(path);
                var header = new byte[(int)Math.Min(stream.Length, 64)];
                stream.ReadExactly(header);
                return Inspect(header, stream.Length);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return Invalid("Unreadable", 0, 0, 0, 0, ex.Message);
            }
        }

        public static MapFileInspection Inspect(ReadOnlySpan<byte> header, long fileLength)
        {
            if (header.Length < 4)
                return Invalid("Unknown", 0, 0, fileLength, 4, "Map header is shorter than 4 bytes.");

            string format;
            int widthOffset;
            int heightOffset;
            int xorOffset = -1;
            long dataOffset;
            int cellBytes;

            if (header[2] == 0x43 && header[3] == 0x23)
            {
                format = "CSharpV1";
                if (header.Length < 8)
                    return Invalid(format, 0, 0, fileLength, 8, "C# map header is truncated.");
                if (header[0] != 1 || header[1] != 0)
                    return Invalid(format, 0, 0, fileLength, 8, $"Unsupported C# map version {header[0]}.{header[1]}.");
                widthOffset = 4;
                heightOffset = 6;
                dataOffset = 8;
                cellBytes = 26;
            }
            else
            {
                if (header.Length < 20)
                    return Invalid("Unknown", 0, 0, fileLength, 20, "Map header is shorter than 20 bytes.");

                if (header[0] == 0)
                {
                    format = "Mir3WeMade";
                    widthOffset = 22;
                    heightOffset = 24;
                    dataOffset = -1;
                    cellBytes = 14;
                }
                else if (header[0] == 0x0F && header[5] == 0x53 && header[14] == 0x33)
                {
                    format = "Mir3Shanda";
                    widthOffset = 16;
                    heightOffset = 18;
                    dataOffset = 40;
                    cellBytes = 20;
                }
                else if (header[0] == 0x15 && header[4] == 0x32 && header[6] == 0x41 && header[19] == 0x31)
                {
                    format = "Mir2AntiHack";
                    widthOffset = 31;
                    xorOffset = 33;
                    heightOffset = 35;
                    dataOffset = 64;
                    cellBytes = 12;
                }
                else if (header[0] == 0x10 && header[2] == 0x61 && header[7] == 0x31 && header[14] == 0x31)
                {
                    format = "Mir2_2010";
                    widthOffset = 21;
                    xorOffset = 23;
                    heightOffset = 25;
                    dataOffset = 54;
                    cellBytes = 15;
                }
                else if (header[4] == 0x0F || header[4] == 0x03 && header[18] == 0x0D && header[19] == 0x0A)
                {
                    widthOffset = 0;
                    heightOffset = 2;
                    dataOffset = 52;
                    var encodedWidth = BinaryPrimitives.ReadUInt16LittleEndian(header.Slice(widthOffset, 2));
                    var encodedHeight = BinaryPrimitives.ReadUInt16LittleEndian(header.Slice(heightOffset, 2));
                    var cells = (long)encodedWidth * encodedHeight;
                    if (fileLength >= dataOffset + cells * 36)
                    {
                        format = "Shanda2012";
                        cellBytes = 36;
                    }
                    else if (fileLength >= dataOffset + cells * 14)
                    {
                        format = "ShandaOld";
                        cellBytes = 14;
                    }
                    else
                    {
                        format = "OldSchool";
                        cellBytes = 12;
                    }
                }
                else if (header[0] == 0x0D && header[1] == 0x4C && header[7] == 0x20 && header[11] == 0x6D)
                {
                    format = "Heroes";
                    widthOffset = 21;
                    heightOffset = 25;
                    dataOffset = 54;
                    cellBytes = 15;
                }
                else
                {
                    format = "OldSchool";
                    widthOffset = 0;
                    heightOffset = 2;
                    dataOffset = 52;
                    cellBytes = 12;
                }
            }

            var requiredHeader = Math.Max(widthOffset, Math.Max(heightOffset, xorOffset)) + 2;
            if (header.Length < requiredHeader)
                return Invalid(format, 0, 0, fileLength, requiredHeader, $"{format} map header is truncated.");

            var width = ReadDimension(header, widthOffset, xorOffset);
            var height = ReadDimension(header, heightOffset, xorOffset);
            if (width <= 0 || height <= 0)
                return Invalid(format, width, height, fileLength, requiredHeader, $"Invalid map dimensions {width}x{height}.");

            if (format == "Mir3WeMade")
                dataOffset = 28 + 3L * ((width / 2) + (width % 2)) * (height / 2);

            long requiredBytes;
            try
            {
                requiredBytes = checked(dataOffset + checked((long)width * height) * cellBytes);
            }
            catch (OverflowException)
            {
                return Invalid(format, width, height, fileLength, long.MaxValue, "Map dimensions overflow the supported file size.");
            }

            if (fileLength < requiredBytes)
                return Invalid(format, width, height, fileLength, requiredBytes,
                    $"Map data is truncated: {fileLength} bytes, expected at least {requiredBytes} for {width}x{height}.");

            return new MapFileInspection
            {
                Format = format,
                Width = width,
                Height = height,
                ActualBytes = fileLength,
                RequiredBytes = requiredBytes
            };
        }

        private static int ReadDimension(ReadOnlySpan<byte> header, int offset, int xorOffset)
        {
            var value = BinaryPrimitives.ReadInt16LittleEndian(header.Slice(offset, 2));
            if (xorOffset < 0) return value;
            var key = BinaryPrimitives.ReadInt16LittleEndian(header.Slice(xorOffset, 2));
            return value ^ key;
        }

        private static MapFileInspection Invalid(string format, int width, int height, long actualBytes,
            long requiredBytes, string error) => new MapFileInspection
        {
            Format = format,
            Width = width,
            Height = height,
            ActualBytes = actualBytes,
            RequiredBytes = requiredBytes,
            Error = error
        };
    }
}

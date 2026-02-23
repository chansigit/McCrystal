using System.IO.Compression;
using SkiaSharp;

public class LibReader : IDisposable
{
    private readonly FileStream _stream;
    private readonly BinaryReader _reader;
    private readonly int[] _indexList;
    private readonly int _count;

    public int Count => _count;

    public LibReader(string path)
    {
        _stream = new FileStream(path, FileMode.Open, FileAccess.Read);
        _reader = new BinaryReader(_stream);

        int version = _reader.ReadInt32();
        _count = _reader.ReadInt32();

        if (version >= 3)
            _reader.ReadInt32(); // frameSeek

        _indexList = new int[_count];
        for (int i = 0; i < _count; i++)
            _indexList[i] = _reader.ReadInt32();
    }

    public string GetBase64Png(int index)
    {
        if (index < 0 || index >= _count)
            return null;

        int offset = _indexList[index];
        if (offset <= 0)
            return null;

        try
        {
            _stream.Seek(offset, SeekOrigin.Begin);

            short width = _reader.ReadInt16();
            short height = _reader.ReadInt16();
            _reader.ReadInt16(); // X
            _reader.ReadInt16(); // Y
            _reader.ReadInt16(); // ShadowX
            _reader.ReadInt16(); // ShadowY
            _reader.ReadByte();  // Shadow
            int length = _reader.ReadInt32();

            if (width <= 0 || height <= 0 || length <= 0)
                return null;

            byte[] compressed = _reader.ReadBytes(length);
            byte[] bgra = Decompress(compressed);

            int expectedSize = width * height * 4;
            if (bgra.Length < expectedSize)
                return null;

            // Fix alpha: pixels with color data but alpha=0 should be opaque
            for (int i = 0; i < expectedSize; i += 4)
            {
                byte a = bgra[i + 3];
                if (a == 0 && (bgra[i] != 0 || bgra[i + 1] != 0 || bgra[i + 2] != 0))
                    bgra[i + 3] = 255;
            }

            using var bitmap = new SKBitmap(width, height, SKColorType.Bgra8888, SKAlphaType.Unpremul);
            var pixels = bitmap.GetPixels();
            System.Runtime.InteropServices.Marshal.Copy(bgra, 0, pixels, expectedSize);

            using var image = SKImage.FromBitmap(bitmap);
            using var data = image.Encode(SKEncodedImageFormat.Png, 100);
            return Convert.ToBase64String(data.ToArray());
        }
        catch
        {
            return null;
        }
    }

    private static byte[] Decompress(byte[] data)
    {
        using var input = new MemoryStream(data);
        using var gzip = new GZipStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        gzip.CopyTo(output);
        return output.ToArray();
    }

    public void Dispose()
    {
        _reader?.Dispose();
        _stream?.Dispose();
    }
}

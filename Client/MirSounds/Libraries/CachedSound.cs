using Microsoft.Xna.Framework.Audio;

namespace Client.MirSounds.Libraries
{
    class CachedSound : IDisposable
    {
        public int Index { get; private set; }
        public long ExpireTime { get; set; }
        public SoundEffect Effect { get; private set; }

        public CachedSound(int index, string fileName)
        {
            Index = index;

            fileName = Path.Combine(Settings.SoundPath, fileName);
            string fileType = Path.GetExtension(fileName);

            // attempt to find file
            if (String.IsNullOrEmpty(fileType))
            {
                foreach (String ext in SoundManager.SupportedFileTypes)
                {
                    if (File.Exists($"{fileName}{ext}"))
                    {
                        fileName = $"{fileName}{ext}";
                        fileType = ext;

                        break;
                    }
                }
            }

            if (SoundManager.SupportedFileTypes.Contains(fileType) &&
                File.Exists(fileName))
            {
                try
                {
                    using (var stream = File.OpenRead(fileName))
                    {
                        Effect = SoundEffect.FromStream(stream);
                    }
                }
                catch
                {
                    Effect = null;
                }
            }
        }

        public void Dispose()
        {
            Effect?.Dispose();
            Effect = null;
        }
    }
}

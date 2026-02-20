using Microsoft.Xna.Framework.Audio;

namespace Client.MirSounds.Libraries
{
    internal class LoopProvider : ISoundLibrary, IDisposable
    {
        public int Index { get; set; }
        public long ExpireTime { get; set; }

        private SoundEffect _soundEffect;
        private SoundEffectInstance _instance;

        private int _unscaledVolume;
        private string _fileName;
        private bool _loop;
        private bool _isDisposing;

        public static LoopProvider TryCreate(int index, string fileName, int volume, bool loop)
        {
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
                return new LoopProvider(index, fileName, volume, loop);
            }
            else
            {
                return null;
            }
        }

        public LoopProvider(int index, string fileName, int volume, bool loop)
        {
            Index = index;
            _loop = loop;
            _fileName = fileName;

            try
            {
                using (var stream = File.OpenRead(fileName))
                {
                    _soundEffect = SoundEffect.FromStream(stream);
                }

                _instance = _soundEffect.CreateInstance();
                _instance.IsLooped = loop;
            }
            catch
            {
                _soundEffect = null;
                _instance = null;
            }

            Play(volume);
        }

        public bool IsPlaying()
        {
            return _instance?.State == SoundState.Playing;
        }

        public void Play(int volume)
        {
            if (_instance == null) return;

            if (_instance.State == SoundState.Playing)
            {
                return;
            }

            ExpireTime = CMain.Time + Settings.SoundCleanMinutes * 60 * 1000;

            _instance.Volume = ScaleVolume(volume);

            try
            {
                _instance.Play();
            }
            catch { }
        }

        public void SetVolume(int vol)
        {
            if (_instance == null) return;
            _instance.Volume = ScaleVolume(vol);
        }

        public void Stop()
        {
            Dispose();
        }

        public void Dispose()
        {
            _isDisposing = true;

            _instance?.Stop();
            _instance?.Dispose();
            _soundEffect?.Dispose();
            _instance = null;
            _soundEffect = null;
        }

        private float ScaleVolume(int volume)
        {
            _unscaledVolume = volume;
            return Math.Clamp(volume / 100f, 0f, 1f);
        }
    }
}

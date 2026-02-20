using Client.MirSounds.Libraries;
using Microsoft.Xna.Framework.Audio;

namespace Client.MirSounds
{
    public static class SoundManager
    {
        private static Dictionary<int, string> _indexList => SoundList.Indexes;
        private static List<KeyValuePair<long, int>> _delayList = new List<KeyValuePair<long, int>>();
        private static Dictionary<int, CachedSound> _cachedOneShots = new Dictionary<int, CachedSound>();

        private static Dictionary<int, LoopProvider> _loopingSounds = new Dictionary<int, LoopProvider>();
        private static LoopProvider _music;

        private static int _vol;
        private static int _musicVol;

        public static readonly List<string> SupportedFileTypes;
        private static long _checkSoundTime;
        public static ISoundLibrary Music => _music;

        public static int Vol
        {
            get { return _vol; }
            set
            {
                if (_vol == value) return;
                _vol = value;

                AdjustAllVolumes();
            }
        }

        public static int MusicVol
        {
            get { return _musicVol; }
            set
            {
                if (_musicVol == value) return;
                _musicVol = value;

                _music?.SetVolume(MusicVol);
            }
        }

        static SoundManager()
        {
            _checkSoundTime = CMain.Time + 30 * 1000;

            SupportedFileTypes = new List<string>
            {
                ".wav",
                // .mp3 not directly supported by MonoGame SoundEffect
                // Users should convert .mp3 to .wav or .ogg
            };

            SoundList.LoadSoundList();
        }

        public static void Create()
        {
            // MonoGame audio is initialized automatically with the Game
        }

        public static void PlaySound(int index, bool loop = false, int delay = 0)
        {
            CheckSoundTimeOut();

            if (delay > 0)
            {
                _delayList.Add(new KeyValuePair<long, int>(CMain.Time + delay, index));
                return;
            }

            if (!_indexList.ContainsKey(index))
            {
                string filename = index > 20000 ?
                                    string.Format("M{0:0}-{1:0}", (index - 20000) / 10, index % 10) :
                                    string.Format("{0:000}-{1:0}", index / 10, index % 10);

                _indexList.Add(index, filename);
            }

            if (!loop)
            {
                if (!_cachedOneShots.TryGetValue(index, out CachedSound cachedSound))
                {
                    cachedSound = new CachedSound(index, _indexList[index]);
                    _cachedOneShots.Add(index, cachedSound);
                }

                if (cachedSound.Effect != null)
                {
                    try
                    {
                        var instance = cachedSound.Effect.CreateInstance();
                        instance.Volume = ScaleVolume(_vol);
                        instance.Play();
                    }
                    catch { }
                    cachedSound.ExpireTime = CMain.Time + Settings.SoundCleanMinutes * 60 * 1000;
                }
            }
            else
            {
                var sound = LoopProvider.TryCreate(index, _indexList[index], MusicVol, loop);
                if (sound != null)
                {
                    _loopingSounds[index] = sound;
                    _loopingSounds[index].Play(Vol);
                }
            }
        }

        public static void StopSound(int index)
        {
            if (_loopingSounds.ContainsKey(index))
            {
                _loopingSounds[index].Stop();
            }
        }

        public static void PlayMusic(int index, bool loop = false)
        {
            StopMusic();

            if (_indexList.TryGetValue(index, out string value))
            {
                _music = LoopProvider.TryCreate(index, value, MusicVol, loop);
            }
        }

        public static void StopMusic()
        {
            _music?.Stop();
            _music?.Dispose();
        }

        public static void ProcessDelayedSounds()
        {
            if (_delayList.Count == 0) return;

            var sounds = _delayList.Where(x => x.Key <= CMain.Time).ToList();

            foreach (var sound in sounds)
            {
                _delayList.Remove(sound);

                PlaySound(sound.Value);
            }
        }

        private static void AdjustAllVolumes()
        {
            foreach (int key in _loopingSounds.Keys)
            {
                _loopingSounds[key].SetVolume(Vol);
            }
        }

        private static float ScaleVolume(int volume)
        {
            return Math.Clamp(volume / 100f, 0f, 1f);
        }

        private static void CheckSoundTimeOut()
        {
            if (CMain.Time >= _checkSoundTime)
            {
                _checkSoundTime = CMain.Time + 30 * 1000;

                List<int> keysToRemove = new List<int>();
                foreach (var key in _cachedOneShots.Keys)
                {
                    if (CMain.Time > _cachedOneShots[key].ExpireTime)
                    {
                        keysToRemove.Add(key);
                    }
                }

                keysToRemove.ForEach(key =>
                {
                    _cachedOneShots[key].Dispose();
                    _cachedOneShots.Remove(key);
                });

                keysToRemove.Clear();
                foreach(var key in _loopingSounds.Keys)
                {
                    if (CMain.Time > _loopingSounds[key].ExpireTime)
                    {
                        keysToRemove.Add(key);
                    }
                }

                keysToRemove.ForEach(key => { _loopingSounds.Remove(key); });
            }
        }

        public static void Dispose()
        {
            _music?.Dispose();

            foreach (var sound in _loopingSounds.Values) { sound.Stop(); }

            foreach (var cached in _cachedOneShots.Values) { cached.Dispose(); }
            _cachedOneShots.Clear();
        }
    }
}

using System.Diagnostics;
using Client.MirControls;
using Client.MirGraphics;
using Client.MirNetwork;
using Client.MirScenes;
using Client.MirSounds;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;
using SkiaSharp;

namespace Client
{
    public class CMain : Game
    {
        public static MirControl DebugBaseLabel, HintBaseLabel;
        public static MirLabel DebugTextLabel, HintTextLabel, ScreenshotTextLabel;
        public static Point MPoint;

        public readonly static Stopwatch Timer = Stopwatch.StartNew();
        public readonly static DateTime StartTime = DateTime.UtcNow;
        public static long Time;
        public static DateTime Now { get { return StartTime.AddMilliseconds(Time); } }
        public static readonly Random Random = new Random();

        public static string DebugText = "";

        private static long _fpsTime;
        private static int _fps;
        private static long _cleanTime;
        private static long _drawTime;
        public static int FPS;
        public static int DPS;
        public static int DPSCounter;

        public static long PingTime;
        public static long NextPing = 10000;

        public static bool Shift, Alt, Ctrl, Tilde, SpellTargetLock;
        public static double BytesSent, BytesReceived;

        public static KeyBindSettings InputKeys = new KeyBindSettings();

        private GraphicsDeviceManager _graphics;

        // Input state tracking
        private MouseState _previousMouseState;
        private KeyboardState _previousKeyboardState;
        private bool _mouseWasPressed;
        private static long _lastClickTime;
        private static MouseButtons _lastClickButton;

        // DPI for font scaling (default 96)
        public static float DpiX = 96f;

        // Compatibility stub for TextRenderer.MeasureText calls
        public static object Graphics => null;

        /// <summary>
        /// Compatibility stub for WinForms Controls collection.
        /// In the WinForms version, MirTextBox added a real TextBox to this collection.
        /// In MonoGame, this returns an empty collection so legacy iteration loops are no-ops.
        /// </summary>
        public ControlCollection Controls { get; } = new ControlCollection();

        /// <summary>
        /// Compatibility stub for WinForms Close() method.
        /// MonoGame Game uses Exit() instead.
        /// </summary>
        public void Close()
        {
            Exit();
        }

        /// <summary>
        /// Compatibility stub for WinForms ActiveControl property.
        /// Returns null since MonoGame doesn't use WinForms controls.
        /// </summary>
        public object ActiveControl { get; set; }

        /// <summary>
        /// Compatibility stub for Control.IsKeyLocked (e.g. CapsLock check).
        /// Uses SDL2 to check the actual key lock state.
        /// </summary>
        public static bool IsKeyLocked(Keys key)
        {
            try
            {
                if (key == Keys.CapsLock)
                {
                    var modState = SDL2.SDL.SDL_GetModState();
                    return (modState & SDL2.SDL.SDL_Keymod.KMOD_CAPS) != 0;
                }
                if (key == Keys.NumLock)
                {
                    var modState = SDL2.SDL.SDL_GetModState();
                    return (modState & SDL2.SDL.SDL_Keymod.KMOD_NUM) != 0;
                }
            }
            catch { }
            return false;
        }

        public CMain()
        {
            _graphics = new GraphicsDeviceManager(this);
            _graphics.PreferredBackBufferWidth = Settings.ScreenWidth;
            _graphics.PreferredBackBufferHeight = Settings.ScreenHeight;
            _graphics.SynchronizeWithVerticalRetrace = Settings.FPSCap;
            _graphics.IsFullScreen = Settings.FullScreen;
            _graphics.HardwareModeSwitch = false; // Use borderless fullscreen

            IsMouseVisible = true;
            IsFixedTimeStep = false;

            Window.AllowUserResizing = false;
            Window.Title = "Legend of Mir";

            // Enable text input for MirTextBox
            Window.TextInput += OnTextInput;
        }

        protected override void Initialize()
        {
            base.Initialize();

            DXManager.Device = GraphicsDevice;
            DXManager.Create();

            SoundManager.Create();

            Window.Title = GameLanguage.ClientTextMap.GetLocalization(ClientTextKeys.GameName);
        }

        protected override void LoadContent()
        {
            base.LoadContent();
        }

        protected override void Update(GameTime gameTime)
        {
            try
            {
                UpdateTime();
                ProcessInput();
                UpdateEnviroment();
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }

            base.Update(gameTime);
        }

        protected override void Draw(GameTime gameTime)
        {
            try
            {
                RenderEnvironment();
                UpdateFrameTime();
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }

            base.Draw(gameTime);
        }

        protected override void OnExiting(object sender, ExitingEventArgs args)
        {
            Settings.Save();
            DXManager.Dispose();
            SoundManager.Dispose();
            base.OnExiting(sender, args);
        }

        #region Input Processing

        private void ProcessInput()
        {
            var mouseState = Mouse.GetState();
            var keyboardState = Keyboard.GetState();

            ProcessMouseInput(mouseState);
            ProcessKeyboardInput(keyboardState);

            _previousMouseState = mouseState;
            _previousKeyboardState = keyboardState;
        }

        private void ProcessMouseInput(MouseState mouseState)
        {
            // Scale mouse coordinates from window/native space to back buffer space
            // On Retina/HiDPI displays, Mouse.GetState() returns coordinates in the window's
            // point space which may differ from the back buffer pixel space.
            int mx = mouseState.X;
            int my = mouseState.Y;

            var clientBounds = Window.ClientBounds;
            int bbW = _graphics.PreferredBackBufferWidth;
            int bbH = _graphics.PreferredBackBufferHeight;

            if (clientBounds.Width > 0 && clientBounds.Height > 0 &&
                (clientBounds.Width != bbW || clientBounds.Height != bbH))
            {
                mx = mx * bbW / clientBounds.Width;
                my = my * bbH / clientBounds.Height;
            }

            MPoint = new Point(mx, my);

            // Mouse move
            if (mouseState.X != _previousMouseState.X || mouseState.Y != _previousMouseState.Y)
            {
                var e = new MouseEventArgs(MouseButtons.None, 0, mx, my, 0);
                CMain_MouseMove(this, e);
            }

            // Mouse buttons
            ProcessMouseButton(mouseState.LeftButton, _previousMouseState.LeftButton, MouseButtons.Left, mx, my);
            ProcessMouseButton(mouseState.RightButton, _previousMouseState.RightButton, MouseButtons.Right, mx, my);
            ProcessMouseButton(mouseState.MiddleButton, _previousMouseState.MiddleButton, MouseButtons.Middle, mx, my);

            // Mouse wheel
            int scrollDelta = mouseState.ScrollWheelValue - _previousMouseState.ScrollWheelValue;
            if (scrollDelta != 0)
            {
                var e = new MouseEventArgs(MouseButtons.None, 0, mx, my, scrollDelta);
                CMain_MouseWheel(this, e);
            }
        }

        private void ProcessMouseButton(ButtonState current, ButtonState previous, MouseButtons button, int mx, int my)
        {
            if (current == ButtonState.Pressed && previous == ButtonState.Released)
            {
                var e = new MouseEventArgs(button, 1, mx, my, 0);
                CMain_MouseDown(this, e);
            }
            else if (current == ButtonState.Released && previous == ButtonState.Pressed)
            {
                var e = new MouseEventArgs(button, 1, mx, my, 0);
                CMain_MouseUp(this, e);
                CMain_MouseClick(this, e);
            }
        }

        private void ProcessKeyboardInput(KeyboardState keyboardState)
        {
            Shift = keyboardState.IsKeyDown(Keys.LeftShift) || keyboardState.IsKeyDown(Keys.RightShift);
            Alt = keyboardState.IsKeyDown(Keys.LeftAlt) || keyboardState.IsKeyDown(Keys.RightAlt);
            Ctrl = keyboardState.IsKeyDown(Keys.LeftControl) || keyboardState.IsKeyDown(Keys.RightControl);

            var currentKeys = keyboardState.GetPressedKeys();
            var previousKeys = _previousKeyboardState.GetPressedKeys();

            // Key down events
            foreach (var key in currentKeys)
            {
                if (!_previousKeyboardState.IsKeyDown(key))
                {
                    var e = new KeyEventArgs(key) { Shift = Shift, Alt = Alt, Control = Ctrl };
                    CMain_KeyDown(this, e);
                }
            }

            // Key up events
            foreach (var key in previousKeys)
            {
                if (!keyboardState.IsKeyDown(key))
                {
                    var e = new KeyEventArgs(key) { Shift = Shift, Alt = Alt, Control = Ctrl };
                    CMain_KeyUp(this, e);
                }
            }
        }

        private void OnTextInput(object sender, TextInputEventArgs e)
        {
            var keyPressArgs = new KeyPressEventArgs(e.Character);
            CMain_KeyPress(this, keyPressArgs);
        }

        #endregion

        #region Event Handlers

        private static void CMain_Deactivate(object sender, EventArgs e)
        {
            MapControl.MapButtons = MouseButtons.None;
            Shift = false;
            Alt = false;
            Ctrl = false;
            Tilde = false;
            SpellTargetLock = false;
        }

        public static void CMain_KeyDown(object sender, KeyEventArgs e)
        {
            Shift = e.Shift;
            Alt = e.Alt;
            Ctrl = e.Control;

            if (!String.IsNullOrEmpty(InputKeys.GetKey(KeybindOptions.TargetSpellLockOn)))
            {
                SpellTargetLock = e.KeyCode == (Keys)Enum.Parse(typeof(Keys), InputKeys.GetKey(KeybindOptions.TargetSpellLockOn), true);
            }
            else
            {
                SpellTargetLock = false;
            }

            if (e.KeyCode == Keys.OemTilde)
                CMain.Tilde = true;

            try
            {
                if (e.Alt && e.KeyCode == Keys.Enter)
                {
                    ToggleFullScreen();
                    return;
                }

                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnKeyDown(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void CMain_MouseMove(object sender, MouseEventArgs e)
        {
            MPoint = new Point(e.X, e.Y);

            try
            {
                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnMouseMove(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void CMain_KeyUp(object sender, KeyEventArgs e)
        {
            Shift = e.Shift;
            Alt = e.Alt;
            Ctrl = e.Control;

            if (!String.IsNullOrEmpty(InputKeys.GetKey(KeybindOptions.TargetSpellLockOn)))
            {
                SpellTargetLock = e.KeyCode == (Keys)Enum.Parse(typeof(Keys), InputKeys.GetKey(KeybindOptions.TargetSpellLockOn), true);
            }
            else
            {
                SpellTargetLock = false;
            }

            if (e.KeyCode == Keys.OemTilde)
                CMain.Tilde = false;

            foreach (KeyBind KeyCheck in CMain.InputKeys.Keylist)
            {
                if (KeyCheck.function != KeybindOptions.Screenshot) continue;
                if (KeyCheck.Key != e.KeyCode)
                    continue;
                if ((KeyCheck.RequireAlt != 2) && (KeyCheck.RequireAlt != (Alt ? 1 : 0)))
                    continue;
                if ((KeyCheck.RequireShift != 2) && (KeyCheck.RequireShift != (Shift ? 1 : 0)))
                    continue;
                if ((KeyCheck.RequireCtrl != 2) && (KeyCheck.RequireCtrl != (Ctrl ? 1 : 0)))
                    continue;
                if ((KeyCheck.RequireTilde != 2) && (KeyCheck.RequireTilde != (Tilde ? 1 : 0)))
                    continue;
                Program.Form.CreateScreenShot();
                break;
            }

            try
            {
                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnKeyUp(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void CMain_KeyPress(object sender, KeyPressEventArgs e)
        {
            try
            {
                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnKeyPress(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void CMain_MouseDoubleClick(object sender, MouseEventArgs e)
        {
            try
            {
                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnMouseClick(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void CMain_MouseUp(object sender, MouseEventArgs e)
        {
            MapControl.MapButtons &= ~e.Button;
            if (e.Button != MouseButtons.Right || !Settings.NewMove)
                GameScene.CanRun = false;

            try
            {
                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnMouseUp(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void CMain_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right && (GameScene.SelectedCell != null || GameScene.PickedUpGold))
            {
                GameScene.SelectedCell = null;
                GameScene.PickedUpGold = false;
                return;
            }

            try
            {
                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnMouseDown(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void CMain_MouseClick(object sender, MouseEventArgs e)
        {
            try
            {
                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnMouseClick(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void CMain_MouseWheel(object sender, MouseEventArgs e)
        {
            try
            {
                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.OnMouseWheel(e);
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        #endregion

        #region Game Loop Helpers

        private static void UpdateTime()
        {
            Time = Timer.ElapsedMilliseconds;
        }

        private static void UpdateFrameTime()
        {
            if (Time >= _fpsTime)
            {
                _fpsTime = Time + 1000;
                FPS = _fps;
                _fps = 0;

                DPS = DPSCounter;
                DPSCounter = 0;
            }
            else
                _fps++;
        }

        private static void UpdateEnviroment()
        {
            if (Time >= _cleanTime)
            {
                _cleanTime = Time + 1000;

                DXManager.Clean(); // Clean once a second.
            }

            Network.Process();

            if (MirScene.ActiveScene != null)
                MirScene.ActiveScene.Process();

            for (int i = 0; i < MirAnimatedControl.Animations.Count; i++)
                MirAnimatedControl.Animations[i].UpdateOffSet();

            for (int i = 0; i < MirAnimatedButton.Animations.Count; i++)
                MirAnimatedButton.Animations[i].UpdateOffSet();

            CreateHintLabel();

            if (Settings.DebugMode)
            {
                CreateDebugLabel();
            }
        }

        private static void RenderEnvironment()
        {
            try
            {
                if (DXManager.DeviceLost)
                {
                    DXManager.AttemptReset();
                    Thread.Sleep(1);
                    return;
                }

                DXManager.Device.Clear(Color.Black);
                DXManager.BeginSpriteBatch();

                if (MirScene.ActiveScene != null)
                    MirScene.ActiveScene.Draw();

                DXManager.EndSpriteBatch();
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
                DXManager.AttemptRecovery();
            }
        }

        #endregion

        #region UI Labels

        private static void CreateDebugLabel()
        {
            string text;

            if (MirControl.MouseControl != null)
            {
                text = string.Format("FPS: {0}", FPS);
                text += string.Format(", DPS: {0}", DPS);
                text += string.Format(", Time: {0:HH:mm:ss UTC}", Now);

                if (MirControl.MouseControl is MapControl)
                    text += string.Format(", Co Ords: {0}", MapControl.MapLocation);

                if (MirControl.MouseControl is MirImageControl)
                    text += string.Format(", Control: {0}", MirControl.MouseControl.GetType().Name);

                if (MirScene.ActiveScene is GameScene)
                    text += string.Format(", Objects: {0}", MapControl.Objects.Count);

                if (MirScene.ActiveScene is GameScene && !string.IsNullOrEmpty(DebugText))
                    text += string.Format(", Debug: {0}", DebugText);

                if (MirObjects.MapObject.MouseObject != null)
                    text += string.Format(", Target: {0}", MirObjects.MapObject.MouseObject.Name);
                else
                    text += string.Format(", Target: none");
            }
            else
            {
                text = string.Format("FPS: {0}", FPS);
            }

            text += string.Format(", Ping: {0}", PingTime);
            text += string.Format(", Sent: {0}, Received: {1}", Functions.ConvertByteSize(BytesSent), Functions.ConvertByteSize(BytesReceived));
            text += string.Format(", TLC: {0}", DXManager.TextureList.Count(x => x.TextureValid));
            text += string.Format(", CLC: {0}", DXManager.ControlList.Count(x => x.IsDisposed == false));

            if (DebugBaseLabel == null || DebugBaseLabel.IsDisposed)
            {
                DebugBaseLabel = new MirControl
                {
                    BackColour = Color.FromNonPremultiplied(50, 50, 50, 255),
                    Border = true,
                    BorderColour = Color.Black,
                    DrawControlTexture = true,
                    Location = new Point(5, 5),
                    NotControl = true,
                    Opacity = 0.5F
                };
            }

            if (DebugTextLabel == null || DebugTextLabel.IsDisposed)
            {
                DebugTextLabel = new MirLabel
                {
                    AutoSize = true,
                    BackColour = Color.Transparent,
                    ForeColour = Color.White,
                    Parent = DebugBaseLabel,
                };

                DebugTextLabel.SizeChanged += (o, e) => DebugBaseLabel.Size = DebugTextLabel.Size;
            }

            DebugTextLabel.Text = text;

            if (!Settings.FullScreen)
            {
                Program.Form.Window.Title = $"{GameLanguage.ClientTextMap.GetLocalization(ClientTextKeys.GameName)} - {text}";
            }
        }

        private static void CreateHintLabel()
        {
            if (HintBaseLabel == null || HintBaseLabel.IsDisposed)
            {
                HintBaseLabel = new MirControl
                {
                    BackColour = Color.FromNonPremultiplied(0, 0, 0, 255),
                    Border = true,
                    DrawControlTexture = true,
                    BorderColour = Color.FromNonPremultiplied(144, 144, 0, 255),
                    ForeColour = Color.Yellow,
                    Parent = MirScene.ActiveScene,
                    NotControl = true,
                    Opacity = 0.5F
                };
            }

            if (HintTextLabel == null || HintTextLabel.IsDisposed)
            {
                HintTextLabel = new MirLabel
                {
                    AutoSize = true,
                    BackColour = Color.Transparent,
                    ForeColour = Color.Yellow,
                    Parent = HintBaseLabel,
                };

                HintTextLabel.SizeChanged += (o, e) => HintBaseLabel.Size = HintTextLabel.Size;
            }

            if (MirControl.MouseControl == null || string.IsNullOrEmpty(MirControl.MouseControl.Hint))
            {
                HintBaseLabel.Visible = false;
                return;
            }

            HintBaseLabel.Visible = true;

            HintTextLabel.Text = MirControl.MouseControl.Hint;

            Point point = MPoint.Add(-HintTextLabel.Size.Width, 20);

            if (point.X + HintBaseLabel.Size.Width >= Settings.ScreenWidth)
                point.X = Settings.ScreenWidth - HintBaseLabel.Size.Width - 1;
            if (point.Y + HintBaseLabel.Size.Height >= Settings.ScreenHeight)
                point.Y = Settings.ScreenHeight - HintBaseLabel.Size.Height - 1;

            if (point.X < 0)
                point.X = 0;
            if (point.Y < 0)
                point.Y = 0;

            HintBaseLabel.Location = point;
        }

        #endregion

        private static void ToggleFullScreen()
        {
            Settings.FullScreen = !Settings.FullScreen;

            Program.Form._graphics.IsFullScreen = Settings.FullScreen;
            Program.Form._graphics.ApplyChanges();

            if (MirScene.ActiveScene == GameScene.Scene)
            {
                GameScene.Scene.MapControl.FloorValid = false;
                GameScene.Scene.TextureValid = false;
            }
        }

        public void CreateScreenShot()
        {
            try
            {
                string text = string.Format("[{0} Server {1}] {2} {3:hh\\:mm\\:ss}",
                    Settings.P_ServerName.Length > 0 ? Settings.P_ServerName : "Crystal",
                    MapControl.User != null ? MapControl.User.Name : "",
                    Now.ToShortDateString(),
                    Now.TimeOfDay);

                int w = GraphicsDevice.PresentationParameters.BackBufferWidth;
                int h = GraphicsDevice.PresentationParameters.BackBufferHeight;

                byte[] data = new byte[w * h * 4];
                GraphicsDevice.GetBackBufferData(data);

                // Use SkiaSharp to save screenshot
                using (var bitmap = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Premul))
                {
                    // Write pixel data directly to bitmap
                    System.Runtime.InteropServices.Marshal.Copy(data, 0, bitmap.GetPixels(), data.Length);

                    using (var canvas = new SKCanvas(bitmap))
                    {
                        using (var paint = new SKPaint())
                        {
                            paint.TextSize = 12;
                            paint.IsAntialias = true;
                            paint.Color = SKColors.White;
                            canvas.DrawText(text, w / 2f, 14, paint);
                        }
                    }

                    string path = Path.Combine(AppContext.BaseDirectory, "Screenshots");
                    if (!Directory.Exists(path))
                        Directory.CreateDirectory(path);

                    int count = Directory.GetFiles(path, "*.png").Length;

                    using (var image = SKImage.FromBitmap(bitmap))
                    using (var encodedData = image.Encode(SKEncodedImageFormat.Png, 100))
                    using (var stream = File.OpenWrite(Path.Combine(path, $"Image {count}.png")))
                    {
                        encodedData.SaveTo(stream);
                    }
                }
            }
            catch (Exception ex)
            {
                SaveError(ex.ToString());
            }
        }

        public static void SaveError(string ex)
        {
            try
            {
                if (Settings.RemainingErrorLogs-- > 0)
                {
                    File.AppendAllText(Path.Combine(".", "Error.txt"),
                                       string.Format("[{0}] {1}{2}", Now, ex, Environment.NewLine));
                }
            }
            catch
            {
            }
        }

        public static void SetResolution(int width, int height)
        {
            if (Settings.ScreenWidth == width && Settings.ScreenHeight == height) return;

            Settings.ScreenWidth = width;
            Settings.ScreenHeight = height;

            Program.Form._graphics.PreferredBackBufferWidth = width;
            Program.Form._graphics.PreferredBackBufferHeight = height;
            Program.Form._graphics.ApplyChanges();
        }

        #region Mouse Cursor

        public static MouseCursor CurrentCursor = MouseCursor.None;

        public static void SetMouseCursor(MouseCursor cursor)
        {
            // MonoGame cursor support - for now just track the cursor state
            // Custom .CUR files would need conversion to textures
            CurrentCursor = cursor;
        }

        #endregion
    }
}

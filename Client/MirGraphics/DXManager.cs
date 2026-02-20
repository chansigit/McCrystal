using Client.MirControls;
using Client.MirScenes;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using SkiaSharp;

namespace Client.MirGraphics
{
    class DXManager
    {
        public static List<MImage> TextureList = new List<MImage>();
        public static List<MirControl> ControlList = new List<MirControl>();

        public static GraphicsDevice Device;
        public static SpriteBatch Sprite;

        public static RenderTarget2D CurrentSurface;
        public static RenderTarget2D MainSurface; // null means back buffer

        public static bool DeviceLost;
        public static float Opacity = 1F;
        public static bool Blending;
        public static float BlendingRate;
        public static BlendMode BlendingMode;

        public static Texture2D RadarTexture;
        public static List<Texture2D> Lights = new List<Texture2D>();
        public static Texture2D PoisonDotBackground;

        public static RenderTarget2D FloorTexture, LightTexture;

        // 1x1 white pixel texture for line drawing
        public static Texture2D WhitePixel;

        public static Effect GrayScaleEffect;
        public static Effect NormalEffect;
        public static Effect MagicEffect;

        // Multiply blend: result = src * dst (used for lighting overlay)
        public static readonly BlendState MultiplyBlend = new BlendState
        {
            ColorBlendFunction = BlendFunction.Add,
            ColorSourceBlend = Blend.DestinationColor,
            ColorDestinationBlend = Blend.Zero,
            AlphaBlendFunction = BlendFunction.Add,
            AlphaSourceBlend = Blend.DestinationAlpha,
            AlphaDestinationBlend = Blend.Zero,
        };

        public static bool GrayScale;

        internal static bool _spriteBatchActive;
        private static BlendState _currentBlendState;
        private static Effect _currentEffect;

        public static Point[] LightSizes =
        {
            new Point(125,95),
            new Point(205,156),
            new Point(285,217),
            new Point(365,277),
            new Point(445,338),
            new Point(525,399),
            new Point(605,460),
            new Point(685,521),
            new Point(765,581),
            new Point(845,642),
            new Point(925,703)
        };

        public static void Create()
        {
            // Device is set from Game.GraphicsDevice in CMain.Initialize()
            LoadTextures();
            LoadEffects();
        }

        private static void LoadEffects()
        {
            // Shaders will be loaded via MonoGame Content Pipeline
            // For now, leave as null - the game can run without shaders
            var shaderNormalPath = Settings.ShadersPath + "normal.fx";
            var shaderGrayScalePath = Settings.ShadersPath + "grayscale.fx";
            var shaderMagicPath = Settings.ShadersPath + "magic.fx";

            // Effects will be loaded once Content Pipeline is set up:
            // NormalEffect = Program.Form.Content.Load<Effect>("normal");
            // GrayScaleEffect = Program.Form.Content.Load<Effect>("grayscale");
            // MagicEffect = Program.Form.Content.Load<Effect>("magic");
        }

        private static void LoadTextures()
        {
            Sprite = new SpriteBatch(Device);

            // Create 1x1 white pixel for line drawing
            WhitePixel = new Texture2D(Device, 1, 1);
            WhitePixel.SetData(new[] { Color.White });

            if (RadarTexture == null || RadarTexture.IsDisposed)
            {
                RadarTexture = new Texture2D(Device, 2, 2, false, SurfaceFormat.Color);
                byte[] whiteData = new byte[2 * 2 * 4];
                for (int i = 0; i < whiteData.Length; i++) whiteData[i] = 255;
                RadarTexture.SetData(whiteData);
            }
            if (PoisonDotBackground == null || PoisonDotBackground.IsDisposed)
            {
                PoisonDotBackground = new Texture2D(Device, 5, 5, false, SurfaceFormat.Color);
                byte[] whiteData = new byte[5 * 5 * 4];
                for (int i = 0; i < whiteData.Length; i++) whiteData[i] = 255;
                PoisonDotBackground.SetData(whiteData);
            }
            CreateLights();
        }

        private static void CreateLights()
        {
            for (int i = Lights.Count - 1; i >= 0; i--)
                Lights[i].Dispose();

            Lights.Clear();

            for (int i = 1; i < LightSizes.Length; i++)
            {
                int width = LightSizes[i].X;
                int height = LightSizes[i].Y;

                // Use SkiaSharp to create radial gradient ellipse
                byte[] pixelData = new byte[width * height * 4];

                using (var bitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Premul))
                using (var canvas = new SKCanvas(bitmap))
                {
                    canvas.Clear(SKColors.Transparent);

                    float cx = width / 2f;
                    float cy = height / 2f;

                    using (var shader = SKShader.CreateRadialGradient(
                        new SKPoint(cx, cy),
                        Math.Max(cx, cy),
                        new SKColor[]
                        {
                            new SKColor(255, 255, 255, 255),
                            new SKColor(210, 210, 210, 255),
                            new SKColor(160, 160, 160, 255),
                            new SKColor(70, 70, 70, 255),
                            new SKColor(40, 40, 40, 255),
                            new SKColor(0, 0, 0, 0)
                        },
                        new float[] { 0f, 0.20f, 0.40f, 0.60f, 0.80f, 1.0f },
                        SKShaderTileMode.Clamp))
                    using (var paint = new SKPaint())
                    {
                        paint.Shader = shader;
                        paint.IsAntialias = true;
                        canvas.DrawOval(cx, cy, cx, cy, paint);
                    }

                    canvas.Flush();

                    // Copy pixels - SkiaSharp uses RGBA which matches MonoGame SurfaceFormat.Color
                    var pixels = bitmap.GetPixelSpan();
                    pixels.CopyTo(pixelData);
                }

                Texture2D light = new Texture2D(Device, width, height, false, SurfaceFormat.Color);
                light.SetData(pixelData);
                Lights.Add(light);
            }
        }

        public static void SetSurface(RenderTarget2D surface)
        {
            if (CurrentSurface == surface)
                return;

            EndSpriteBatch();
            CurrentSurface = surface;
            Device.SetRenderTarget(surface); // null = back buffer
            BeginSpriteBatch();
        }

        public static void SetGrayscale(bool value)
        {
            GrayScale = value;

            if (value)
            {
                if (_currentEffect == GrayScaleEffect) return;
                EndSpriteBatch();
                _currentEffect = GrayScaleEffect;
                BeginSpriteBatch();
            }
            else
            {
                if (_currentEffect == null) return;
                EndSpriteBatch();
                _currentEffect = null;
                BeginSpriteBatch();
            }
        }

        public static void DrawOpaque(Texture2D texture, Rectangle sourceRect, Vector2 position, Color color, float opacity)
        {
            color = color * opacity;
            Draw(texture, sourceRect, position, color);
        }

        public static void Draw(Texture2D texture, Rectangle sourceRect, Vector2 position, Color color)
        {
            if (texture == null || texture.IsDisposed) return;
            if (!_spriteBatchActive) BeginSpriteBatch();
            Sprite.Draw(texture, position, sourceRect, color);
            CMain.DPSCounter++;
        }

        // Overload accepting Vector3 for compatibility (Z is ignored)
        public static void Draw(Texture2D texture, Rectangle? sourceRect, Vector3? position, Color color)
        {
            if (texture == null || texture.IsDisposed) return;
            Vector2 pos = position.HasValue ? new Vector2(position.Value.X, position.Value.Y) : Vector2.Zero;
            Rectangle src = sourceRect ?? new Rectangle(0, 0, texture.Width, texture.Height);
            Draw(texture, src, pos, color);
        }

        public static void DrawOpaque(Texture2D texture, Rectangle? sourceRect, Vector3? position, Color color, float opacity)
        {
            color = color * opacity;
            Draw(texture, sourceRect, position, color);
        }

        public static void AttemptReset()
        {
            // MonoGame handles device loss internally
            DeviceLost = false;
        }

        public static void ResetDevice()
        {
            CleanUp();
            DeviceLost = true;

            if (Device == null) return;

            LoadTextures();
            DeviceLost = false;
        }

        public static void AttemptRecovery()
        {
            try { EndSpriteBatch(); } catch { }

            try
            {
                CurrentSurface = null;
                Device.SetRenderTarget(null);
            }
            catch { }
        }

        public static void SetOpacity(float opacity)
        {
            if (Opacity == opacity) return;
            Opacity = opacity;
            // Opacity is handled per-draw call via Color multiplication
        }

        public static void SetBlend(bool value, float rate = 1F, BlendMode mode = BlendMode.NORMAL)
        {
            if (value == Blending && BlendingRate == rate && BlendingMode == mode) return;

            Blending = value;
            BlendingRate = rate;
            BlendingMode = mode;

            EndSpriteBatch();

            if (Blending)
            {
                switch (BlendingMode)
                {
                    case BlendMode.INVLIGHT:
                        _currentBlendState = new BlendState
                        {
                            ColorSourceBlend = Blend.BlendFactor,
                            ColorDestinationBlend = Blend.InverseSourceColor,
                            ColorBlendFunction = BlendFunction.Add,
                            AlphaSourceBlend = Blend.SourceAlpha,
                            AlphaDestinationBlend = Blend.InverseSourceAlpha,
                            BlendFactor = new Color((byte)(255 * BlendingRate), (byte)(255 * BlendingRate), (byte)(255 * BlendingRate), (byte)(255 * BlendingRate))
                        };
                        break;
                    default:
                        _currentBlendState = new BlendState
                        {
                            ColorSourceBlend = Blend.SourceAlpha,
                            ColorDestinationBlend = Blend.One,
                            AlphaSourceBlend = Blend.SourceAlpha,
                            AlphaDestinationBlend = Blend.One,
                        };
                        break;
                }
            }
            else
            {
                _currentBlendState = BlendState.AlphaBlend;
            }

            BeginSpriteBatch();
        }

        public static void SetNormal(float blend, Color tintcolor)
        {
            if (NormalEffect == null) return;
            if (_currentEffect == NormalEffect) return;

            EndSpriteBatch();
            _currentEffect = NormalEffect;
            NormalEffect.Parameters["Blend"]?.SetValue(new Vector4(1.0f, 1.0f, 1.0f, blend));
            NormalEffect.Parameters["TintColor"]?.SetValue(new Vector4(tintcolor.R / 255f, tintcolor.G / 255f, tintcolor.B / 255f, 1.0f));
            BeginSpriteBatch();
        }

        public static void SetGrayscale(float blend, Color tintcolor)
        {
            if (GrayScaleEffect == null) return;
            if (_currentEffect == GrayScaleEffect) return;

            EndSpriteBatch();
            _currentEffect = GrayScaleEffect;
            GrayScaleEffect.Parameters["Blend"]?.SetValue(new Vector4(1.0f, 1.0f, 1.0f, blend));
            GrayScaleEffect.Parameters["TintColor"]?.SetValue(new Vector4(tintcolor.R / 255f, tintcolor.G / 255f, tintcolor.B / 255f, 1.0f));
            BeginSpriteBatch();
        }

        public static void SetBlendMagic(float blend, Color tintcolor)
        {
            if (MagicEffect == null) return;
            if (_currentEffect == MagicEffect) return;

            EndSpriteBatch();
            _currentEffect = MagicEffect;
            MagicEffect.Parameters["Blend"]?.SetValue(new Vector4(1.0f, 1.0f, 1.0f, blend));
            MagicEffect.Parameters["TintColor"]?.SetValue(new Vector4(tintcolor.R / 255f, tintcolor.G / 255f, tintcolor.B / 255f, 1.0f));
            BeginSpriteBatch();
        }

        public static void BeginSpriteBatch()
        {
            if (_spriteBatchActive) return;
            Sprite.Begin(SpriteSortMode.Deferred, _currentBlendState ?? BlendState.AlphaBlend,
                SamplerState.PointClamp, null, null, _currentEffect);
            _spriteBatchActive = true;
        }

        public static void EndSpriteBatch()
        {
            if (!_spriteBatchActive) return;
            Sprite.End();
            _spriteBatchActive = false;
        }

        // DrawLine using 1x1 white texture
        public static void DrawLine(Vector2 start, Vector2 end, Color color)
        {
            if (WhitePixel == null) return;
            Vector2 edge = end - start;
            float angle = (float)Math.Atan2(edge.Y, edge.X);
            float length = edge.Length();

            if (!_spriteBatchActive) BeginSpriteBatch();
            Sprite.Draw(WhitePixel, start, null, color, angle, Vector2.Zero, new Vector2(length, 1), SpriteEffects.None, 0);
        }

        // Draw rectangle border using lines
        public static void DrawRectangleBorder(Rectangle rect, Color color)
        {
            DrawLine(new Vector2(rect.Left - 1, rect.Top - 1), new Vector2(rect.Right, rect.Top - 1), color);
            DrawLine(new Vector2(rect.Left - 1, rect.Top - 1), new Vector2(rect.Left - 1, rect.Bottom), color);
            DrawLine(new Vector2(rect.Left - 1, rect.Bottom), new Vector2(rect.Right, rect.Bottom), color);
            DrawLine(new Vector2(rect.Right, rect.Top - 1), new Vector2(rect.Right, rect.Bottom), color);
        }

        // Draw filled rectangle
        public static void DrawFilledRectangle(Rectangle rect, Color color)
        {
            if (WhitePixel == null) return;
            if (!_spriteBatchActive) BeginSpriteBatch();
            Sprite.Draw(WhitePixel, rect, color);
        }

        public static void Clean()
        {
            for (int i = TextureList.Count - 1; i >= 0; i--)
            {
                MImage m = TextureList[i];

                if (m == null)
                {
                    TextureList.RemoveAt(i);
                    continue;
                }

                if (CMain.Time <= m.CleanTime) continue;

                m.DisposeTexture();
            }

            for (int i = ControlList.Count - 1; i >= 0; i--)
            {
                MirControl c = ControlList[i];

                if (c == null)
                {
                    ControlList.RemoveAt(i);
                    continue;
                }

                if (CMain.Time <= c.CleanTime) continue;

                c.DisposeTexture();
            }
        }

        private static void CleanUp()
        {
            EndSpriteBatch();

            Sprite?.Dispose();
            Sprite = null;

            PoisonDotBackground?.Dispose();
            PoisonDotBackground = null;

            RadarTexture?.Dispose();
            RadarTexture = null;

            FloorTexture?.Dispose();
            FloorTexture = null;

            LightTexture?.Dispose();
            LightTexture = null;

            if (Lights != null)
            {
                for (int i = 0; i < Lights.Count; i++)
                    Lights[i]?.Dispose();
                Lights.Clear();
            }

            WhitePixel?.Dispose();
            WhitePixel = null;

            for (int i = TextureList.Count - 1; i >= 0; i--)
            {
                MImage m = TextureList[i];
                if (m == null) continue;
                m.DisposeTexture();
            }
            TextureList.Clear();

            for (int i = ControlList.Count - 1; i >= 0; i--)
            {
                MirControl c = ControlList[i];
                if (c == null) continue;
                c.DisposeTexture();
            }
            ControlList.Clear();
        }

        public static void Dispose()
        {
            CleanUp();

            GrayScaleEffect?.Dispose();
            NormalEffect?.Dispose();
            MagicEffect?.Dispose();
        }
    }
}

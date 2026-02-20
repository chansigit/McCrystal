using Client.MirGraphics;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using SkiaSharp;

namespace Client.MirControls
{
    public class MirLabel : MirControl
    {
        #region Auto Size
        private bool _autoSize;
        public bool AutoSize
        {
            get { return _autoSize; }
            set
            {
                if (_autoSize == value)
                    return;
                _autoSize = value;
                OnAutoSizeChanged(EventArgs.Empty);
            }
        }
        public event EventHandler AutoSizeChanged;
        private void OnAutoSizeChanged(EventArgs e)
        {
            TextureValid = false;
            GetSize();
            if (AutoSizeChanged != null)
                AutoSizeChanged.Invoke(this, e);
        }
        #endregion

        #region DrawFormat
        private TextFormatFlags _drawFormat;
        public TextFormatFlags DrawFormat
        {
            get { return _drawFormat; }
            set
            {
                _drawFormat = value;
                OnDrawFormatChanged(EventArgs.Empty);
            }
        }
        public event EventHandler DrawFormatChanged;
        private void OnDrawFormatChanged(EventArgs e)
        {
            TextureValid = false;

            if (DrawFormatChanged != null)
                DrawFormatChanged.Invoke(this, e);
        }
        #endregion

        #region Font
        private float _fontSize;
        private string _fontName;
        public float FontSize
        {
            get { return _fontSize; }
            set
            {
                _fontSize = MirControl.ScaleFontSize(value);
                TextureValid = false;
                GetSize();
            }
        }
        public string FontName
        {
            get { return _fontName; }
            set
            {
                _fontName = value;
                TextureValid = false;
                GetSize();
            }
        }

        public Font Font
        {
            get { return new Font(_fontName ?? Settings.FontName, _fontSize > 0 ? _fontSize : 8f); }
            set
            {
                if (value is Client.Font f)
                {
                    _fontName = f.FontFamily;
                    _fontSize = ScaleFontSize(f.Size);
                }
                TextureValid = false;
                GetSize();
            }
        }
        public event EventHandler FontChanged;
        #endregion

        #region Out Line
        private bool _outLine;
        public bool OutLine
        {
            get { return _outLine; }
            set
            {
                if (_outLine == value)
                    return;
                _outLine = value;
                OnOutLineChanged(EventArgs.Empty);
            }
        }
        public event EventHandler OutLineChanged;
        private void OnOutLineChanged(EventArgs e)
        {
            TextureValid = false;
            GetSize();

            if (OutLineChanged != null)
                OutLineChanged.Invoke(this, e);
        }
        #endregion

        #region Out Line Colour
        private Color _outLineColour;
        public Color OutLineColour
        {
            get { return _outLineColour; }
            set
            {
                if (_outLineColour == value)
                    return;
                _outLineColour = value;
                OnOutLineColourChanged();
            }
        }
        public event EventHandler OutLineColourChanged;
        private void OnOutLineColourChanged()
        {
            TextureValid = false;

            if (OutLineColourChanged != null)
                OutLineColourChanged.Invoke(this, EventArgs.Empty);
        }
        #endregion

        #region Size

        private void GetSize()
        {
            if (!AutoSize)
                return;

            if (string.IsNullOrEmpty(_text))
                Size = Size.Empty;
            else
            {
                Size = MeasureText(_text, _fontName, _fontSize);

                if (OutLine && Size != Size.Empty)
                    Size = new Size(Size.Width + 2, Size.Height + 2);
            }
        }

        private static Size MeasureText(string text, string fontName, float fontSize)
        {
            using (var paint = new SKPaint())
            {
                paint.TextSize = fontSize > 0 ? fontSize : 10;
                paint.IsAntialias = true;
                paint.Typeface = SKTypeface.FromFamilyName(fontName ?? Settings.FontName);

                var bounds = new SKRect();
                paint.MeasureText(text, ref bounds);

                // Add some padding
                int width = (int)Math.Ceiling(bounds.Width) + 4;
                int height = (int)Math.Ceiling(paint.FontSpacing) + 2;

                // Handle multi-line text
                if (text.Contains('\n'))
                {
                    string[] lines = text.Split('\n');
                    float maxWidth = 0;
                    foreach (var line in lines)
                    {
                        float w = paint.MeasureText(line);
                        if (w > maxWidth) maxWidth = w;
                    }
                    width = (int)Math.Ceiling(maxWidth) + 4;
                    height = (int)Math.Ceiling(paint.FontSpacing * lines.Length) + 2;
                }

                return new Size(Math.Max(1, width), Math.Max(1, height));
            }
        }
        #endregion

        #region Label
        private string _text;
        public string Text
        {
            get { return _text; }
            set
            {
                if (_text == value)
                    return;

                _text = value;
                OnTextChanged(EventArgs.Empty);
            }
        }
        public event EventHandler TextChanged;
        private void OnTextChanged(EventArgs e)
        {
            DrawControlTexture = !string.IsNullOrEmpty(Text);
            TextureValid = false;
            Redraw();

            GetSize();

            if (TextChanged != null)
                TextChanged.Invoke(this, e);
        }
        #endregion

        public MirLabel()
        {
            DrawControlTexture = true;
            _drawFormat = TextFormatFlags.WordBreak;

            _fontName = Settings.FontName;
            _fontSize = MirControl.ScaleFontSize(8F);
            _outLine = true;
            _outLineColour = Color.Black;
            _text = string.Empty;
        }

        protected override void CreateTexture()
        {
            if (string.IsNullOrEmpty(Text))
                return;

            if (Size.Width == 0 || Size.Height == 0)
                return;

            if (TextureSize != Size)
                DisposeTexture();

            if (ControlTexture == null || ControlTexture.IsDisposed)
            {
                DXManager.ControlList.Add(this);
                ControlTexture = new Texture2D(DXManager.Device, Size.Width, Size.Height, false, SurfaceFormat.Color);
                TextureSize = Size;
            }

            // Use SkiaSharp to render text
            byte[] pixelData;
            using (var bitmap = new SKBitmap(Size.Width, Size.Height, SKColorType.Rgba8888, SKAlphaType.Premul))
            {
                using (var canvas = new SKCanvas(bitmap))
                {
                    // Clear with back colour
                    canvas.Clear(new SKColor(BackColour.R, BackColour.G, BackColour.B, BackColour.A));

                    using (var paint = new SKPaint())
                    {
                        paint.TextSize = _fontSize > 0 ? _fontSize : 10;
                        paint.IsAntialias = true;
                        paint.Typeface = SKTypeface.FromFamilyName(_fontName ?? Settings.FontName);
                        paint.SubpixelText = true;

                        float y = paint.FontSpacing;

                        if (OutLine)
                        {
                            // Draw outline
                            paint.Color = new SKColor(OutLineColour.R, OutLineColour.G, OutLineColour.B, OutLineColour.A);
                            DrawTextWithFormat(canvas, paint, Text, 1, y - 1, Size.Width, Size.Height);
                            DrawTextWithFormat(canvas, paint, Text, 0, y, Size.Width, Size.Height);
                            DrawTextWithFormat(canvas, paint, Text, 2, y, Size.Width, Size.Height);
                            DrawTextWithFormat(canvas, paint, Text, 1, y + 1, Size.Width, Size.Height);

                            // Draw main text
                            paint.Color = new SKColor(ForeColour.R, ForeColour.G, ForeColour.B, ForeColour.A);
                            DrawTextWithFormat(canvas, paint, Text, 1, y, Size.Width, Size.Height);
                        }
                        else
                        {
                            paint.Color = new SKColor(ForeColour.R, ForeColour.G, ForeColour.B, ForeColour.A);
                            DrawTextWithFormat(canvas, paint, Text, 1, y - 1, Size.Width, Size.Height);
                        }
                    }
                }

                pixelData = bitmap.GetPixelSpan().ToArray();
            }

            ControlTexture.SetData(pixelData);
            TextureValid = true;
        }

        private void DrawTextWithFormat(SKCanvas canvas, SKPaint paint, string text, float x, float y, int width, int height)
        {
            if ((_drawFormat & TextFormatFlags.WordBreak) != 0 && text.Contains('\n'))
            {
                string[] lines = text.Split('\n');
                float lineHeight = paint.FontSpacing;
                for (int i = 0; i < lines.Length; i++)
                {
                    canvas.DrawText(lines[i], x, y + i * lineHeight, paint);
                }
            }
            else
            {
                canvas.DrawText(text, x, y, paint);
            }
        }

        #region Disposable
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);

            if (!disposing) return;

            AutoSizeChanged = null;
            _autoSize = false;

            DrawFormatChanged = null;
            _drawFormat = 0;

            FontChanged = null;
            _fontName = null;

            OutLineChanged = null;
            _outLine = false;

            OutLineColourChanged = null;
            _outLineColour = Color.Transparent;

            TextChanged = null;
            _text = null;
        }
        #endregion

    }
}

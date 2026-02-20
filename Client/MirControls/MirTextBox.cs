using Client.MirGraphics;
using Client.MirScenes;
using Microsoft.Xna.Framework.Graphics;
using SkiaSharp;

namespace Client.MirControls
{
    public sealed class MirTextBox : MirControl
    {
        #region Back Color

        protected override void OnBackColourChanged()
        {
            base.OnBackColourChanged();
            TextureValid = false;
            Redraw();
        }

        #endregion

        #region Enabled

        protected override void OnEnabledChanged()
        {
            base.OnEnabledChanged();
        }

        #endregion

        #region Fore Color

        protected override void OnForeColourChanged()
        {
            base.OnForeColourChanged();
            TextureValid = false;
            Redraw();
        }

        #endregion

        #region Location

        protected override void OnLocationChanged()
        {
            base.OnLocationChanged();
            TextureValid = false;
            Redraw();
        }

        #endregion

        #region Max Length

        private int _maxLength = 256;
        public int MaxLength
        {
            get { return _maxLength; }
            set { _maxLength = value; }
        }

        #endregion

        #region Parent

        protected override void OnParentChanged()
        {
            base.OnParentChanged();
            OnVisibleChanged();
        }

        #endregion

        #region Password

        private bool _password;
        public bool Password
        {
            get { return _password; }
            set
            {
                _password = value;
                TextureValid = false;
                Redraw();
            }
        }

        #endregion

        #region Font

        private float _fontSize;
        private string _fontName;

        public object Font
        {
            get { return null; }
            set
            {
                if (value is Client.Font f)
                {
                    _fontName = f.FontFamily;
                    _fontSize = MirControl.ScaleFontSize(f.Size);
                }
                TextureValid = false;
                Redraw();
            }
        }

        #endregion

        #region Size

        protected override void OnSizeChanged()
        {
            DisposeTexture();
            _size = Size;
            base.OnSizeChanged();
        }

        #endregion

        #region TextBox State

        public bool CanLoseFocus;
        private string _text = "";
        private int _cursorPosition;
        private int _selectionStart;
        private int _selectionLength;
        private bool _focused;
        private long _cursorBlinkTime;
        private bool _cursorVisible = true;
        private int _scrollOffset; // horizontal scroll for single-line

        /// <summary>Tracks the currently focused text box so only one has focus at a time.</summary>
        private static MirTextBox _currentFocused;

        #endregion

        #region Compatibility Properties (WinForms TextBox bridge)

        /// <summary>
        /// Self-referencing property for WinForms compatibility.
        /// Allows code like mirTextBox.TextBox.Text to work by delegating to mirTextBox.Text.
        /// Also supports object initializer syntax: TextBox = { MaxLength = 50 }.
        /// </summary>
        public MirTextBox TextBox => this;

        /// <summary>Event raised when the Text property changes.</summary>
        public event EventHandler TextChanged;

        /// <summary>Event raised when the control receives focus.</summary>
        public event EventHandler GotFocus;

        public int SelectionStart
        {
            get { return _selectionStart; }
            set { _selectionStart = value; }
        }

        public int SelectionLength
        {
            get { return _selectionLength; }
            set { _selectionLength = value; }
        }

        public bool Focused
        {
            get { return _focused; }
        }

        public string SelectedText
        {
            get
            {
                if (_selectionLength <= 0 || _selectionStart < 0 || _selectionStart >= (_text?.Length ?? 0))
                    return string.Empty;
                int len = Math.Min(_selectionLength, _text.Length - _selectionStart);
                return _text.Substring(_selectionStart, len);
            }
        }

        private char _passwordChar;
        public char PasswordChar
        {
            get { return _password ? (_passwordChar != '\0' ? _passwordChar : '*') : '\0'; }
            set
            {
                _passwordChar = value;
                _password = value != '\0';
                TextureValid = false;
                Redraw();
            }
        }

        public object Tag { get; set; }

        public void SelectAll()
        {
            _selectionStart = 0;
            _selectionLength = (_text ?? "").Length;
            _cursorPosition = _selectionLength;
        }

        public void Focus()
        {
            SetFocus();
        }

        /// <summary>Stub for WinForms compatibility. Returns 0.</summary>
        public int GetFirstCharIndexFromLine(int lineNumber)
        {
            if (string.IsNullOrEmpty(_text)) return 0;
            string[] lines = _text.Split('\n');
            int index = 0;
            for (int i = 0; i < lineNumber && i < lines.Length; i++)
                index += lines[i].Length + 1; // +1 for '\n'
            return Math.Min(index, _text.Length);
        }

        /// <summary>Stub for WinForms compatibility. No-op.</summary>
        public void ScrollToCaret()
        {
            // No-op in MonoGame standalone text box
        }

        private void RaiseTextChanged()
        {
            TextChanged?.Invoke(this, EventArgs.Empty);
        }

        private void RaiseGotFocus()
        {
            GotFocus?.Invoke(this, EventArgs.Empty);
        }

        #endregion

        #region Label

        public string Text
        {
            get { return _text ?? ""; }
            set
            {
                _text = value ?? "";
                if (_cursorPosition > _text.Length)
                    _cursorPosition = _text.Length;
                TextureValid = false;
                Redraw();
                RaiseTextChanged();
            }
        }

        public string[] MultiText
        {
            get { return _text?.Split('\n'); }
            set
            {
                _text = value != null ? string.Join("\n", value) : "";
                TextureValid = false;
                Redraw();
            }
        }

        #endregion

        #region Visible

        public override bool Visible
        {
            get { return base.Visible; }
            set
            {
                base.Visible = value;
                OnVisibleChanged();
            }
        }

        protected override void OnVisibleChanged()
        {
            base.OnVisibleChanged();

            if (Visible)
            {
                SetFocus();
            }
            else
            {
                _focused = false;
            }
        }

        #endregion

        #region MultiLine

        private bool _multiline;
        public override void MultiLine()
        {
            _multiline = true;
            DisposeTexture();
            Redraw();
        }

        #endregion

        public MirTextBox()
        {
            BackColour = Color.Black;
            DrawControlTexture = true;
            TextureValid = false;

            _fontName = Settings.FontName;
            _fontSize = MirControl.ScaleFontSize(10F);
            _text = "";
            _cursorPosition = 0;
        }

        public override void OnKeyPress(KeyPressEventArgs e)
        {
            if (!_focused || !Enabled) return;

            char c = e.KeyChar;

            // Handle special keys
            if (c == '\b') // Backspace
            {
                if (_cursorPosition > 0 && _text.Length > 0)
                {
                    _text = _text.Remove(_cursorPosition - 1, 1);
                    _cursorPosition--;
                    TextureValid = false;
                    Redraw();
                    RaiseTextChanged();
                }
                e.Handled = true;
                return;
            }

            if (c == (char)Keys.Escape)
            {
                _focused = false;
                e.Handled = true;
                return;
            }

            if (c == '\r' || c == '\n')
            {
                if (_multiline)
                {
                    InsertChar('\n');
                }
                e.Handled = true;
                return;
            }

            if (c == '\t')
            {
                e.Handled = true;
                return;
            }

            // Normal character input
            if (!char.IsControl(c) || c == ' ')
            {
                InsertChar(c);
                e.Handled = true;
            }

            base.OnKeyPress(e);
        }

        public override void OnKeyDown(KeyEventArgs e)
        {
            if (!_focused || !Enabled) return;

            switch (e.KeyCode)
            {
                case Keys.Left:
                    if (_cursorPosition > 0) _cursorPosition--;
                    TextureValid = false;
                    Redraw();
                    e.Handled = true;
                    break;
                case Keys.Right:
                    if (_cursorPosition < _text.Length) _cursorPosition++;
                    TextureValid = false;
                    Redraw();
                    e.Handled = true;
                    break;
                case Keys.Home:
                    _cursorPosition = 0;
                    TextureValid = false;
                    Redraw();
                    e.Handled = true;
                    break;
                case Keys.End:
                    _cursorPosition = _text.Length;
                    TextureValid = false;
                    Redraw();
                    e.Handled = true;
                    break;
                case Keys.Delete:
                    if (_cursorPosition < _text.Length)
                    {
                        _text = _text.Remove(_cursorPosition, 1);
                        TextureValid = false;
                        Redraw();
                        RaiseTextChanged();
                    }
                    e.Handled = true;
                    break;
                case Keys.V:
                    if (e.Control)
                    {
                        // Paste from clipboard via SDL2
                        try
                        {
                            string clipText = SDL2.SDL.SDL_GetClipboardText();
                            if (!string.IsNullOrEmpty(clipText))
                            {
                                foreach (char c in clipText)
                                {
                                    if (!char.IsControl(c))
                                        InsertChar(c);
                                }
                            }
                        }
                        catch { }
                        e.Handled = true;
                    }
                    break;
                case Keys.C:
                    if (e.Control)
                    {
                        try
                        {
                            SDL2.SDL.SDL_SetClipboardText(_text);
                        }
                        catch { }
                        e.Handled = true;
                    }
                    break;
                case Keys.A:
                    if (e.Control)
                    {
                        _cursorPosition = _text.Length;
                        e.Handled = true;
                    }
                    break;
            }

            base.OnKeyDown(e);
        }

        private void InsertChar(char c)
        {
            if (_text.Length >= _maxLength) return;

            _text = _text.Insert(_cursorPosition, c.ToString());
            _cursorPosition++;
            TextureValid = false;
            Redraw();
            ResetCursorBlink();
            RaiseTextChanged();
        }

        private void ResetCursorBlink()
        {
            _cursorVisible = true;
            _cursorBlinkTime = CMain.Time + 500;
        }

        public override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            SetFocus();
        }

        public void SetFocus()
        {
            // Unfocus the previously focused text box
            if (_currentFocused != null && _currentFocused != this && !_currentFocused.IsDisposed)
            {
                _currentFocused._focused = false;
                _currentFocused.TextureValid = false;
                _currentFocused.Redraw();
            }

            _focused = true;
            _currentFocused = this;
            ResetCursorBlink();
            TextureValid = false;
            Redraw();
            RaiseGotFocus();
        }

        public void DialogChanged()
        {
            MirMessageBox box1 = null;
            MirInputBox box2 = null;
            MirAmountBox box3 = null;

            if (MirScene.ActiveScene != null && MirScene.ActiveScene.Controls.Count > 0)
            {
                box1 = (MirMessageBox) MirScene.ActiveScene.Controls.FirstOrDefault(ob => ob is MirMessageBox);
                box2 = (MirInputBox) MirScene.ActiveScene.Controls.FirstOrDefault(O => O is MirInputBox);
                box3 = (MirAmountBox) MirScene.ActiveScene.Controls.FirstOrDefault(ob => ob is MirAmountBox);
            }

            if ((box1 != null && box1 != Parent) || (box2 != null && box2 != Parent) || (box3 != null && box3 != Parent))
                _focused = false;
        }

        protected override void CreateTexture()
        {
            if (Size.IsEmpty)
                return;

            if (TextureSize != Size)
                DisposeTexture();

            if (ControlTexture == null || ControlTexture.IsDisposed)
            {
                DXManager.ControlList.Add(this);
                ControlTexture = new Texture2D(DXManager.Device, Size.Width, Size.Height, false, SurfaceFormat.Color);
                TextureSize = Size;
            }

            // Update cursor blink
            if (CMain.Time >= _cursorBlinkTime)
            {
                _cursorVisible = !_cursorVisible;
                _cursorBlinkTime = CMain.Time + 500;
            }

            // Render text using SkiaSharp
            byte[] pixelData;
            using (var bitmap = new SKBitmap(Size.Width, Size.Height, SKColorType.Rgba8888, SKAlphaType.Premul))
            {
                using (var canvas = new SKCanvas(bitmap))
                {
                    canvas.Clear(new SKColor(BackColour.R, BackColour.G, BackColour.B, BackColour.A));

                    using (var paint = new SKPaint())
                    {
                        paint.TextSize = _fontSize > 0 ? _fontSize : 12;
                        paint.IsAntialias = true;
                        paint.Typeface = SKTypeface.FromFamilyName(_fontName ?? Settings.FontName);
                        paint.Color = new SKColor(ForeColour.R, ForeColour.G, ForeColour.B, ForeColour.A);

                        string displayText = _password ? new string('*', _text.Length) : _text;

                        float y = paint.FontSpacing;
                        canvas.DrawText(displayText, 2, y, paint);

                        // Draw cursor
                        if (_focused && _cursorVisible)
                        {
                            string textBeforeCursor = _password ?
                                new string('*', _cursorPosition) :
                                _text.Substring(0, Math.Min(_cursorPosition, _text.Length));

                            float cursorX = paint.MeasureText(textBeforeCursor) + 2;

                            using (var cursorPaint = new SKPaint())
                            {
                                cursorPaint.Color = new SKColor(ForeColour.R, ForeColour.G, ForeColour.B, ForeColour.A);
                                cursorPaint.StrokeWidth = 1;
                                canvas.DrawLine(cursorX, 2, cursorX, Size.Height - 2, cursorPaint);
                            }
                        }
                    }
                }

                pixelData = bitmap.GetPixelSpan().ToArray();
            }

            ControlTexture.SetData(pixelData);
            TextureValid = true;
        }

        protected internal override void DrawControl()
        {
            // Force redraw for cursor blink animation
            if (_focused && CMain.Time >= _cursorBlinkTime)
            {
                TextureValid = false;
            }

            base.DrawControl();
        }

        #region Disposable

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);

            if (!disposing) return;

            _text = null;
            _focused = false;
        }

        #endregion
    }
}

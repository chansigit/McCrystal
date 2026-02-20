global using Color = Microsoft.Xna.Framework.Color;
global using Rectangle = Microsoft.Xna.Framework.Rectangle;
global using Keys = Microsoft.Xna.Framework.Input.Keys;
global using BlendState = Microsoft.Xna.Framework.Graphics.BlendState;
global using SurfaceFormat = Microsoft.Xna.Framework.Graphics.SurfaceFormat;
global using Vector2 = Microsoft.Xna.Framework.Vector2;
global using Vector3 = Microsoft.Xna.Framework.Vector3;
global using Vector4 = Microsoft.Xna.Framework.Vector4;
global using Matrix = Microsoft.Xna.Framework.Matrix;

using System.Runtime.InteropServices;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using SkiaSharp;

namespace Client
{
    /// <summary>
    /// Bridge Point type with implicit conversions between System.Drawing.Point and MonoGame Point.
    /// This allows seamless interop between Shared project (System.Drawing) and Client (MonoGame).
    /// </summary>
    public struct Point : IEquatable<Point>
    {
        public int X;
        public int Y;

        public static readonly Point Zero = new Point(0, 0);
        public static readonly Point Empty = new Point(0, 0);

        public Point(int x, int y)
        {
            X = x;
            Y = y;
        }

        public Point(int value)
        {
            X = value;
            Y = value;
        }

        public bool IsEmpty => X == 0 && Y == 0;

        public void Offset(int x, int y) { X += x; Y += y; }
        public void Offset(Point p) { X += p.X; Y += p.Y; }

        // Implicit conversions: System.Drawing.Point <-> Client.Point
        public static implicit operator Point(System.Drawing.Point p) => new Point(p.X, p.Y);
        public static implicit operator System.Drawing.Point(Point p) => new System.Drawing.Point(p.X, p.Y);

        // Implicit conversions: MonoGame Point <-> Client.Point
        public static implicit operator Point(Microsoft.Xna.Framework.Point p) => new Point(p.X, p.Y);
        public static implicit operator Microsoft.Xna.Framework.Point(Point p) => new Microsoft.Xna.Framework.Point(p.X, p.Y);

        public static Point operator +(Point a, Point b) => new Point(a.X + b.X, a.Y + b.Y);
        public static Point operator -(Point a, Point b) => new Point(a.X - b.X, a.Y - b.Y);
        public static bool operator ==(Point a, Point b) => a.X == b.X && a.Y == b.Y;
        public static bool operator !=(Point a, Point b) => !(a == b);

        public bool Equals(Point other) => X == other.X && Y == other.Y;
        public override bool Equals(object obj) => obj is Point p && Equals(p);
        public override int GetHashCode() => HashCode.Combine(X, Y);
        public override string ToString() => $"{{X={X}, Y={Y}}}";
    }

    public struct Size
    {
        public int Width;
        public int Height;

        public static readonly Size Empty = new Size(0, 0);

        public Size(int width, int height)
        {
            Width = width;
            Height = height;
        }

        public bool IsEmpty => Width == 0 && Height == 0;

        // Allow Size <-> Point conversions (used in some legacy code)
        public static implicit operator Point(Size s) => new Point(s.Width, s.Height);
        public static explicit operator Size(Point p) => new Size(p.X, p.Y);

        // Direct conversions: Size <-> MonoGame Point (avoids double implicit conversion chain)
        public static implicit operator Microsoft.Xna.Framework.Point(Size s) => new Microsoft.Xna.Framework.Point(s.Width, s.Height);
        public static implicit operator Size(Microsoft.Xna.Framework.Point p) => new Size(p.X, p.Y);

        public static bool operator ==(Size a, Size b) => a.Width == b.Width && a.Height == b.Height;
        public static bool operator !=(Size a, Size b) => !(a == b);

        public override bool Equals(object obj) => obj is Size s && this == s;
        public override int GetHashCode() => HashCode.Combine(Width, Height);
        public override string ToString() => $"{{Width={Width}, Height={Height}}}";
    }

    public struct PointF
    {
        public float X;
        public float Y;

        public PointF(float x, float y)
        {
            X = x;
            Y = y;
        }

        public static implicit operator PointF(Point p) => new PointF(p.X, p.Y);
    }

    public static class CompatExtensions
    {
        public static Point Add(this Point p, int x, int y) => new Point(p.X + x, p.Y + y);
        public static Point Add(this Point p, Point o) => new Point(p.X + o.X, p.Y + o.Y);
        public static Point Subtract(this Point p, Point o) => new Point(p.X - o.X, p.Y - o.Y);
        public static Point Subtract(this Point p, int x, int y) => new Point(p.X - x, p.Y - y);
        public static int ToArgb(this Color c) => (c.A << 24) | (c.R << 16) | (c.G << 8) | c.B;

        public static bool Contains(this Rectangle r, Point p)
        {
            Microsoft.Xna.Framework.Point mp = p;
            return mp.X >= r.X && mp.X < r.X + r.Width && mp.Y >= r.Y && mp.Y < r.Y + r.Height;
        }

        public static Color FromArgb(int a, int r, int g, int b) => new Color(r, g, b, a);
        public static Color FromArgb(int a, Color c) => new Color(c.R, c.G, c.B, a);

        // Convert System.Drawing.Color to MonoGame Color
        public static Color ToXnaColor(this System.Drawing.Color c) => new Color(c.R, c.G, c.B, c.A);
    }

    public static class Colors
    {
        public static Color FromName(string name)
        {
            var sysColor = System.Drawing.Color.FromName(name);
            if (sysColor.A == 0 && sysColor.R == 0 && sysColor.G == 0 && sysColor.B == 0 && name != "Black")
                return Color.White;
            return new Color(sysColor.R, sysColor.G, sysColor.B, sysColor.A);
        }
    }

    public enum MouseButtons
    {
        None = 0,
        Left = 1,
        Right = 2,
        Middle = 4
    }

    public class MouseEventArgs : EventArgs
    {
        public MouseButtons Button { get; set; }
        public Point Location { get; set; }
        public int X => Location.X;
        public int Y => Location.Y;
        public int Delta { get; set; }

        public MouseEventArgs(MouseButtons button, int clicks, int x, int y, int delta)
        {
            Button = button;
            Location = new Point(x, y);
            Delta = delta;
        }
    }

    public class KeyEventArgs : EventArgs
    {
        public Keys KeyCode { get; set; }
        public bool Shift { get; set; }
        public bool Alt { get; set; }
        public bool Control { get; set; }
        public bool Handled { get; set; }

        public Keys Modifiers
        {
            get
            {
                Keys mods = 0;
                if (Shift) mods |= Keys.LeftShift;
                if (Control) mods |= Keys.LeftControl;
                if (Alt) mods |= Keys.LeftAlt;
                return mods;
            }
        }

        public KeyEventArgs(Keys keyCode)
        {
            KeyCode = keyCode;
        }
    }

    public class KeyPressEventArgs : EventArgs
    {
        public char KeyChar { get; set; }
        public bool Handled { get; set; }

        public KeyPressEventArgs(char keyChar)
        {
            KeyChar = keyChar;
        }
    }

    public delegate void MouseEventHandler(object sender, MouseEventArgs e);
    public delegate void KeyEventHandler(object sender, KeyEventArgs e);
    public delegate void KeyPressEventHandler(object sender, KeyPressEventArgs e);

    [Flags]
    public enum TextFormatFlags
    {
        Default = 0,
        Left = 0,
        WordBreak = 1,
        Right = 2,
        HorizontalCenter = 4,
        VerticalCenter = 8,
        TextBoxControl = 16,
        NoPadding = 32,
        NoPrefix = 64,
        RightToLeft = 128,
        ExpandTabs = 256
    }

    public static class SystemInformation
    {
        public static int DoubleClickTime => 500;
        public static int MouseWheelScrollDelta => 120;
    }

    public class Font
    {
        public string FontFamily { get; }
        public float Size { get; }
        public FontStyle Style { get; }

        /// <summary>
        /// Approximate line height in pixels. Mirrors System.Drawing.Font.Height.
        /// </summary>
        public int Height => (int)Math.Ceiling(Size * 1.6);

        public Font(string family, float size)
        {
            FontFamily = family;
            Size = size;
            Style = FontStyle.Regular;
        }

        public Font(string family, float size, FontStyle style)
        {
            FontFamily = family;
            Size = size;
            Style = style;
        }
    }

    public enum FontStyle
    {
        Regular = 0,
        Bold = 1,
        Italic = 2,
        Strikeout = 4,
        Underline = 8
    }

    public static class TextRenderer
    {
        public static Size MeasureText(object graphics, string text, object font, Size proposedSize, TextFormatFlags flags)
        {
            return MeasureTextInternal(text, font, proposedSize.Width);
        }

        public static Size MeasureText(object graphics, string text, object font)
        {
            return MeasureTextInternal(text, font, int.MaxValue);
        }

        public static Size MeasureText(string text, object font)
        {
            return MeasureTextInternal(text, font, int.MaxValue);
        }

        private static Size MeasureTextInternal(string text, object fontObj, int maxWidth)
        {
            if (string.IsNullOrEmpty(text)) return Size.Empty;

            string fontName = Settings.FontName;
            float fontSize = 10f;

            if (fontObj is Font f)
            {
                fontName = f.FontFamily;
                fontSize = f.Size;
            }

            using (var paint = new SKPaint())
            {
                paint.TextSize = fontSize;
                paint.IsAntialias = true;
                paint.Typeface = SKTypeface.FromFamilyName(fontName ?? Settings.FontName);

                var bounds = new SKRect();
                paint.MeasureText(text, ref bounds);

                int width = (int)Math.Ceiling(bounds.Width) + 4;
                int height = (int)Math.Ceiling(paint.FontSpacing) + 2;

                if (maxWidth > 0 && maxWidth < int.MaxValue && width > maxWidth)
                {
                    int lines = (int)Math.Ceiling((double)width / maxWidth);
                    width = maxWidth;
                    height = height * lines;
                }

                return new Size(Math.Max(1, width), Math.Max(1, height));
            }
        }
    }

    public enum MouseCursor : byte
    {
        None = 0,
        Default = 1,
        Attack = 2,
        AttackRed = 3,
        NPCTalk = 4,
        TextPrompt = 5,
        Trash = 6,
        Upgrade = 7
    }

    /// <summary>
    /// Compatibility stub for System.Windows.Forms.TextBox.
    /// In the WinForms version, each MirTextBox wrapped a real TextBox control
    /// added to the form's Controls collection. In the MonoGame port, MirTextBox
    /// is standalone, so this class exists only to satisfy compile-time references
    /// in legacy code patterns like:
    ///   TextBox T = Program.Form.Controls[i] as TextBox;
    ///   if (T != null && T.Tag != null) ((MirTextBox)T.Tag).DialogChanged();
    /// Since Program.Form.Controls is now empty, these loops are effectively no-ops.
    /// </summary>
#pragma warning disable 67 // Events declared but never raised (compatibility stubs)
    public class TextBox
    {
        public string Text { get; set; } = "";
        public int MaxLength { get; set; } = 256;
        public char PasswordChar { get; set; }
        public bool Visible { get; set; }
        public object Tag { get; set; }
        public int SelectionStart { get; set; }
        public int SelectionLength { get; set; }
        public string SelectedText { get; set; } = "";
        public bool Focused { get; set; }

        public event EventHandler TextChanged;
        public event EventHandler GotFocus;
        public event KeyPressEventHandler KeyPress;
        public event KeyEventHandler KeyDown;
        public event KeyEventHandler KeyUp;

        public void SelectAll() { SelectionStart = 0; SelectionLength = Text?.Length ?? 0; }
        public void Focus() { Focused = true; }
        public int GetFirstCharIndexFromLine(int lineNumber) { return 0; }
        public void ScrollToCaret() { }
    }
#pragma warning restore 67

    /// <summary>
    /// Compatibility stub for a WinForms-style Controls collection.
    /// Returns an empty collection so that iteration loops compile and run as no-ops.
    /// </summary>
    public class ControlCollection : System.Collections.Generic.List<TextBox>
    {
    }

    /// <summary>
    /// P/Invoke bindings for SDL2 functions used by the client.
    /// MonoGame DesktopGL bundles the SDL2 native library but does not expose
    /// the C# bindings publicly, so we call into the native library directly.
    /// </summary>
    public static class SDL2
    {
        public static class SDL
        {
            private const string nativeLibName = "SDL2";

            [DllImport(nativeLibName, EntryPoint = "SDL_GetClipboardText", CallingConvention = CallingConvention.Cdecl)]
            private static extern IntPtr SDL_GetClipboardText_Native();

            public static string SDL_GetClipboardText()
            {
                IntPtr ptr = SDL_GetClipboardText_Native();
                return ptr == IntPtr.Zero ? string.Empty : Marshal.PtrToStringUTF8(ptr);
            }

            [DllImport(nativeLibName, CallingConvention = CallingConvention.Cdecl)]
            public static extern int SDL_SetClipboardText([MarshalAs(UnmanagedType.LPUTF8Str)] string text);

            [DllImport(nativeLibName, CallingConvention = CallingConvention.Cdecl)]
            public static extern SDL_Keymod SDL_GetModState();

            [Flags]
            public enum SDL_Keymod : ushort
            {
                KMOD_NONE = 0x0000,
                KMOD_LSHIFT = 0x0001,
                KMOD_RSHIFT = 0x0002,
                KMOD_LCTRL = 0x0040,
                KMOD_RCTRL = 0x0080,
                KMOD_LALT = 0x0100,
                KMOD_RALT = 0x0200,
                KMOD_LGUI = 0x0400,
                KMOD_RGUI = 0x0800,
                KMOD_NUM = 0x1000,
                KMOD_CAPS = 0x2000,
                KMOD_MODE = 0x4000,
            }
        }
    }
}

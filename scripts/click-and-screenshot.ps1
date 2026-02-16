# Click a combo box and take a screenshot of the dropdown area.
# Runs elevated. Output: E:\downloads\browser\rslh-test\dropdown.png
param(
    [int]$x,
    [int]$y
)

Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;

public class ScreenCapture {
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);

    public static void ClickAndCapture(int x, int y, string outputPath) {
        SetProcessDpiAwareness(2);

        // Click the combo box
        SetCursorPos(x, y);
        Thread.Sleep(200);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(100);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(500);

        // Screenshot the area around the click (wider to capture the dropdown)
        int captureX = x - 150;
        int captureY = y - 30;
        int captureW = 400;
        int captureH = 350;

        using (Bitmap bmp = new Bitmap(captureW, captureH)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(captureX, captureY, 0, 0, new Size(captureW, captureH));
            }
            bmp.Save(outputPath, ImageFormat.Png);
        }
    }
}
'@ -ReferencedAssemblies System.Drawing

[ScreenCapture]::ClickAndCapture($x, $y, "E:\downloads\browser\rslh-test\dropdown.png")

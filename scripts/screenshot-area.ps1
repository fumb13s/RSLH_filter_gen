# Take a screenshot of a specific area. Runs elevated for DPI awareness.
param(
    [int]$captureX,
    [int]$captureY,
    [int]$captureW = 900,
    [int]$captureH = 200,
    [string]$output = "E:\downloads\browser\rslh-test\screenshot.png"
)

Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class ScreenCapture {
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);

    public static void Capture(int x, int y, int w, int h, string outputPath) {
        SetProcessDpiAwareness(2);
        using (Bitmap bmp = new Bitmap(w, h)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
            }
            bmp.Save(outputPath, ImageFormat.Png);
        }
    }
}
'@ -ReferencedAssemblies System.Drawing

[ScreenCapture]::Capture($captureX, $captureY, $captureW, $captureH, $output)

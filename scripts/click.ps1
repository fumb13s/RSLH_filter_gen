# Clean process: position cursor and click
# Sets DPI awareness first to avoid coordinate corruption when a DPI-unaware app is in foreground
param([int]$x, [int]$y)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class Clicker {
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    public static string Click(int x, int y) {
        // Per-monitor DPI aware v2
        SetProcessDpiAwareness(2);

        SetCursorPos(x, y);
        Thread.Sleep(200);

        POINT p;
        GetCursorPos(out p);

        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(100);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);

        return string.Format("Target:{0},{1} Actual:{2},{3}", x, y, p.X, p.Y);
    }
}
'@

Write-Output ([Clicker]::Click($x, $y))

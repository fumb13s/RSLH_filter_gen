# Set text in edit control via WM_SETTEXT, then click Open button.
# Must run elevated. Does NOT load UIAutomation (avoids DPI issues).
param(
    [Parameter(Mandatory=$true)][string]$filePath,
    [int]$editHwnd,
    [int]$openX,
    [int]$openY
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class DialogHelper {
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);

    const uint WM_SETTEXT = 0x000C;

    public static string Run(int editHwnd, int openX, int openY, string path) {
        SetProcessDpiAwareness(2);

        // Set text in edit control
        IntPtr hwnd = new IntPtr(editHwnd);
        SendMessage(hwnd, WM_SETTEXT, IntPtr.Zero, path);
        Thread.Sleep(300);

        // Click Open button
        SetCursorPos(openX, openY);
        Thread.Sleep(200);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(100);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);

        return "OK";
    }
}
'@

Write-Output ([DialogHelper]::Run($editHwnd, $openX, $openY, $filePath))

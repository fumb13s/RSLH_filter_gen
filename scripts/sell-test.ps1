# Configure the Sell Test with a test item and check the result.
# Must run elevated. Uses click to open combo + mouse scroll to navigate.
# Combo box positions (from UIAutomation):
#   Col1 (X≈-759 center): ArtifactSet(Y≈707), Rank(Y≈736), Rarity(Y≈765), Faction(Y≈795)
#   Col2 (X≈-567 center): ArtifactType(Y≈707), MainStat(Y≈736), Level(Y≈765)
#   Col3 (X≈-388 center): SubStat1(Y≈707), SubStat2(Y≈736), SubStat3(Y≈765), SubStat4(Y≈795)
#   Col4 (X≈-298 center): SubStatValue NumericEdits
param(
    [int]$targetPid = 34600,
    [string]$output = "E:\downloads\browser\rslh-test\sell-test-result.png"
)

Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;

public class SellTestHelper {
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, IntPtr e);

    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const int WHEEL_DELTA = 120;

    public static void Init() { SetProcessDpiAwareness(2); }

    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(150);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(300);
    }

    public static void ScrollDown(int notches) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, -WHEEL_DELTA * notches, IntPtr.Zero);
        Thread.Sleep(150);
    }

    public static void ScrollUp(int notches) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, WHEEL_DELTA * notches, IntPtr.Zero);
        Thread.Sleep(150);
    }

    // Open combo, scroll to top, scroll down N items, click to select
    public static void SetComboValue(int comboX, int comboY, int itemIndex) {
        // Click to open dropdown
        Click(comboX, comboY);
        Thread.Sleep(300);

        // Scroll up a lot to reach the top
        for (int i = 0; i < 20; i++) { ScrollUp(1); }
        Thread.Sleep(200);

        // Scroll down to desired item
        for (int i = 0; i < itemIndex; i++) { ScrollDown(1); }
        Thread.Sleep(200);

        // Click the highlighted item (same position, dropdown is right below combo)
        Click(comboX, comboY + 30);
        Thread.Sleep(300);
    }

    public static void Screenshot(int x, int y, int w, int h, string path) {
        using (Bitmap bmp = new Bitmap(w, h)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
            }
            bmp.Save(path, ImageFormat.Png);
        }
    }
}
'@ -ReferencedAssemblies System.Drawing

[SellTestHelper]::Init()

# Click Reset first
[SellTestHelper]::Click(-211, 821)
Start-Sleep -Milliseconds 500

# Set Artifact Set: Speed (index 3 if: Life=0, Offense=1, Defense=2, Speed=3)
[SellTestHelper]::SetComboValue(-759, 707, 3)

# Set Rank: 6-star (index 5 if: 1=0, 2=1, 3=2, 4=3, 5=4, 6=5)
[SellTestHelper]::SetComboValue(-759, 736, 5)

# Set Rarity: Legendary (index 4 if: Common=0, Uncommon=1, Rare=2, Epic=3, Legendary=4)
[SellTestHelper]::SetComboValue(-759, 765, 4)

# Screenshot the result
Start-Sleep -Milliseconds 500
[SellTestHelper]::Screenshot(-910, 660, 900, 200, $output)

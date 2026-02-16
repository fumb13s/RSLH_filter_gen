# Click a combo box and immediately dump new elements that appear.
# Runs entirely elevated to avoid focus loss.
# Output written to E:\downloads\browser\rslh-test\dump-output.txt
param(
    [int]$x,
    [int]$y,
    [int]$targetPid = 34600
)

$outFile = "E:\downloads\browser\rslh-test\dump-output.txt"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class Clicker {
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
    public static void Click(int x, int y) {
        SetProcessDpiAwareness(2);
        SetCursorPos(x, y);
        Thread.Sleep(200);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(100);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    }
}
'@

$output = @()

# Click the target
[Clicker]::Click($x, $y)
Start-Sleep -Milliseconds 500

$root = [System.Windows.Automation.AutomationElement]::RootElement

# Check all windows from the target PID
$condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
$allFromPid = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
$output += "Windows from PID $targetPid`: $($allFromPid.Count)"

foreach ($w in $allFromPid) {
    $cls = $w.Current.ClassName
    $name = $w.Current.Name
    $r = $w.Current.BoundingRectangle
    $output += "  '$name' ($cls) X=$([int]$r.X) Y=$([int]$r.Y) $([int]$r.Width)x$([int]$r.Height)"
}

# Search for any List/Popup/Menu/Drop elements in all windows from this PID
foreach ($w in $allFromPid) {
    $allDesc = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($el in $allDesc) {
        $cls = $el.Current.ClassName
        if ($cls -like '*List*' -or $cls -like '*Popup*' -or $cls -like '*Menu*' -or $cls -like '*Drop*') {
            $r = $el.Current.BoundingRectangle
            $output += "Found: '$($el.Current.Name)' ($cls) X=$([int]$r.X) Y=$([int]$r.Y) $([int]$r.Width)x$([int]$r.Height)"
            # Dump children
            $items = $el.FindAll([System.Windows.Automation.TreeScope]::Children,
                [System.Windows.Automation.Condition]::TrueCondition)
            $output += "  Children: $($items.Count)"
            foreach ($item in $items) {
                $output += "    '$($item.Current.Name)' ($($item.Current.ClassName))"
            }
        }
    }
}

# Also look for any new window with a small/medium size (popup list)
foreach ($w in $allFromPid) {
    $r = $w.Current.BoundingRectangle
    if ([int]$r.Width -lt 300 -and [int]$r.Height -lt 500 -and $w.Current.ClassName -ne 'TfrmMain') {
        $output += "Small window: '$($w.Current.Name)' ($($w.Current.ClassName)) $([int]$r.Width)x$([int]$r.Height)"
        # Deep dump this window
        function DumpEl($el, $depth) {
            if ($depth -gt 5) { return }
            $indent = "  " * $depth
            $r2 = $el.Current.BoundingRectangle
            $script:output += "$indent[$($el.Current.ClassName)] '$($el.Current.Name)' $([int]$r2.Width)x$([int]$r2.Height)"
            $ch = $el.FindAll([System.Windows.Automation.TreeScope]::Children,
                [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($c in $ch) { DumpEl $c ($depth + 1) }
        }
        DumpEl $w 1
    }
}

$output | Out-File $outFile -Encoding UTF8

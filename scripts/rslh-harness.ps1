# RSL Helper test harness — run this ELEVATED (one UAC prompt).
# Provides click, scroll, screenshot, combo-set, and find-element functions.
# UIAutomation is never loaded in this process to avoid DPI corruption.
#
# Server mode (from WSL2):
#   powershell.exe -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File <path>\rslh-harness.ps1 -targetPid <PID>'"
#   Then send commands by writing JSON to $testDir\harness-cmd.json
#   Read results from $testDir\harness-result.json
#
# Interactive mode (from an already-elevated PowerShell):
#   . .\rslh-harness.ps1 -targetPid <PID> -interactive
param(
    [Parameter(Mandatory=$true)][int]$targetPid,
    [string]$testDir = "E:\downloads\browser\rslh-test",
    [switch]$interactive
)

# ── P/Invoke helpers (no UIAutomation!) ──────────────────────────────────────

Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;

public class RslhHelper {
    [DllImport("shcore.dll")]
    static extern int SetProcessDpiAwareness(int value);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT p);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint f, uint dx, uint dy, int d, IntPtr e);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP   = 0x0004;
    const uint MOUSEEVENTF_WHEEL    = 0x0800;
    const int  WHEEL_DELTA          = 120;
    const uint WM_SETTEXT           = 0x000C;

    static bool _dpiSet = false;

    public static void EnsureDpi() {
        if (!_dpiSet) {
            SetProcessDpiAwareness(2); // Per-monitor DPI aware v2
            _dpiSet = true;
        }
    }

    public static void Click(int x, int y) {
        EnsureDpi();
        SetCursorPos(x, y);
        Thread.Sleep(150);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(300);
    }

    public static void DoubleClick(int x, int y) {
        Click(x, y);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(300);
    }

    public static void ScrollDown(int notches) {
        EnsureDpi();
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, -WHEEL_DELTA * notches, IntPtr.Zero);
        Thread.Sleep(150);
    }

    public static void ScrollUp(int notches) {
        EnsureDpi();
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, WHEEL_DELTA * notches, IntPtr.Zero);
        Thread.Sleep(150);
    }

    // Open combo, scroll to top, scroll down to desired index, click to select.
    // Dropdown geometry (calibrated via click tests on Rarity combo):
    //   first item center 18px below combo center, 32px per row, ~7 visible rows.
    const int DD_FIRST_OFFSET  = 18;
    const int DD_ITEM_HEIGHT   = 32;
    const int DD_VISIBLE_COUNT = 7;

    public static void SetCombo(int comboX, int comboY, int itemIndex, int maxItems) {
        // Click to open dropdown
        Click(comboX, comboY);
        Thread.Sleep(300);

        if (maxItems <= DD_VISIBLE_COUNT) {
            // Small dropdown: all items visible, click directly at the row
            int clickY = comboY + DD_FIRST_OFFSET + itemIndex * DD_ITEM_HEIGHT;
            Click(comboX, clickY);
        } else {
            // Large dropdown: scroll to top, then scroll down to desired index
            for (int i = 0; i < maxItems; i++) { ScrollUp(1); }
            Thread.Sleep(200);

            for (int i = 0; i < itemIndex; i++) { ScrollDown(1); }
            Thread.Sleep(200);

            // Highlighted item is at row min(index, visibleCount-1) from dropdown top
            int row = Math.Min(itemIndex, DD_VISIBLE_COUNT - 1);
            int clickY = comboY + DD_FIRST_OFFSET + row * DD_ITEM_HEIGHT;
            Click(comboX, clickY);
        }
        Thread.Sleep(300);
    }

    public static void SetText(int hwnd, string text) {
        EnsureDpi();
        SendMessage(new IntPtr(hwnd), WM_SETTEXT, IntPtr.Zero, text);
        Thread.Sleep(200);
    }

    public static void Screenshot(int x, int y, int w, int h, string path) {
        EnsureDpi();
        using (Bitmap bmp = new Bitmap(w, h)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
            }
            bmp.Save(path, ImageFormat.Png);
        }
    }

    public static string GetCursorInfo() {
        POINT p;
        GetCursorPos(out p);
        return string.Format("{0},{1}", p.X, p.Y);
    }
}
'@ -ReferencedAssemblies System.Drawing

[RslhHelper]::EnsureDpi()

# ── Window position + Sell Test layout offsets ───────────────────────────────

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Sell Test combo/value offsets from main window origin (dX, dY)
$ST = @{
    # Buttons (also findable via UIAutomation)
    SellSetup    = @(186, 506)
    LoadSetup    = @(1090, 364)
    SellTestOpen = @(1208, 670)
    Reset        = @(1078, 816)
    # Col1 combos
    ArtifactSet  = @(513, 707)
    Rank         = @(513, 736)
    Rarity       = @(513, 765)
    Faction      = @(513, 794)
    # Col2 combos
    ArtifactType = @(708, 707)
    MainStat     = @(708, 736)
    Level        = @(708, 765)
    # Col3 combos
    SubStat1     = @(893, 707)
    SubStat2     = @(893, 736)
    SubStat3     = @(893, 765)
    SubStat4     = @(893, 794)
    # Col4 numeric values
    Value1       = @(1028, 707)
    Value2       = @(1028, 736)
    Value3       = @(1028, 765)
    Value4       = @(1028, 794)
    # Status area
    StatusLabel  = @(780, 816)
}

# Max items per dropdown (for scroll-to-top)
$ComboMax = @{
    ArtifactSet  = 68
    ArtifactType = 9
    Rank         = 6
    Rarity       = 6
    Faction      = 17
    MainStat     = 12
    Level        = 5
    SubStat      = 12
}

# Window origin — resolved at startup or on demand
$script:WinX = 0
$script:WinY = 0

function Get-WindowPos {
    # Calls find-ui.ps1 to get the main window bounding rect
    $findArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', @"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
`$root = [System.Windows.Automation.AutomationElement]::RootElement
`$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
`$win = `$root.FindFirst([System.Windows.Automation.TreeScope]::Children, `$cond)
if (`$win) {
    `$r = `$win.Current.BoundingRectangle
    Write-Output ('{{"ok":true,"x":{0},"y":{1},"w":{2},"h":{3}}}' -f [int]`$r.X, [int]`$r.Y, [int]`$r.Width, [int]`$r.Height)
} else {
    Write-Output '{"ok":false,"error":"Window not found"}'
}
"@)
    $output = & powershell.exe @findArgs 2>&1
    $json = $output | Where-Object { $_ -match '^\{' } | Select-Object -First 1
    if ($json) {
        $result = $json | ConvertFrom-Json
        if ($result.ok) {
            $script:WinX = [int]$result.x
            $script:WinY = [int]$result.y
            Write-Host "Window position: $($result.x),$($result.y) ($($result.w)x$($result.h))"
            return $true
        }
    }
    Write-Warning "Failed to get window position"
    return $false
}

# Resolve absolute screen coordinates from offset name
function ST-Pos([string]$name) {
    $off = $ST[$name]
    $x = [int]$script:WinX + [int]$off[0]
    $y = [int]$script:WinY + [int]$off[1]
    return @($x, $y)
}

# ── UIAutomation helper (calls find-ui.ps1 as a non-elevated child) ──────────

function Find-Element {
    param(
        [string]$name,
        [string]$className,
        [string]$parentName,
        [string]$automationId
    )
    $findArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        (Join-Path $scriptDir 'find-ui.ps1'),
        '-targetPid', $targetPid)

    if ($name)         { $findArgs += '-name';         $findArgs += $name }
    if ($className)    { $findArgs += '-className';    $findArgs += $className }
    if ($parentName)   { $findArgs += '-parentName';   $findArgs += $parentName }
    if ($automationId) { $findArgs += '-automationId'; $findArgs += $automationId }

    $output = & powershell.exe @findArgs 2>&1
    $json = $output | Where-Object { $_ -match '^\{' } | Select-Object -First 1
    if (-not $json) {
        Write-Warning "find-ui.ps1 returned no JSON. Raw output: $output"
        return $null
    }
    $result = $json | ConvertFrom-Json
    if (-not $result.ok) {
        Write-Warning "find-ui: $($result.error)"
        return $null
    }
    return $result
}

# ── High-level actions ───────────────────────────────────────────────────────

function Open-SellSetup {
    Write-Host "Opening Sell Setup..."
    $el = Find-Element -name 'Sell Setup'
    if (-not $el) { Write-Error "Sell Setup button not found"; return $false }
    [RslhHelper]::Click($el.cx, $el.cy)
    Start-Sleep -Milliseconds 800
    return $true
}

function Click-LoadSetup {
    Write-Host "Clicking Load Setup..."
    $el = Find-Element -name 'Load Setup'
    if (-not $el) { Write-Error "Load Setup button not found"; return $false }
    [RslhHelper]::Click($el.cx, $el.cy)
    Start-Sleep -Milliseconds 800
    return $true
}

function Load-HsfFile([string]$filePath) {
    Write-Host "Loading .hsf file: $filePath"

    # Find the Edit control inside the Open dialog
    $edit = Find-Element -className 'Edit' -parentName 'Open'
    if (-not $edit) { Write-Error "File dialog Edit control not found"; return $false }

    # Find the Open button inside the Open dialog
    $btn = Find-Element -name 'Open' -className 'Button' -parentName 'Open'
    if (-not $btn) {
        $btn = Find-Element -name '&Open' -className 'Button' -parentName 'Open'
    }
    if (-not $btn) { Write-Error "Open button not found in file dialog"; return $false }

    # Set filename and click Open
    [RslhHelper]::SetText($edit.hwnd, $filePath)
    Start-Sleep -Milliseconds 300
    [RslhHelper]::Click($btn.cx, $btn.cy)
    Start-Sleep -Milliseconds 500
    return $true
}

function Click-Reset {
    Write-Host "Clicking Reset..."
    $el = Find-Element -name 'Reset'
    if (-not $el) {
        $el = Find-Element -name 'btnReset'
        if (-not $el) { Write-Warning "Reset button not found, skipping"; return }
    }
    [RslhHelper]::Click($el.cx, $el.cy)
    Start-Sleep -Milliseconds 500
}

function Take-Screenshot([string]$filename, [int]$x, [int]$y, [int]$w = 900, [int]$h = 200) {
    $path = Join-Path $testDir $filename
    [RslhHelper]::Screenshot($x, $y, $w, $h, $path)
    Write-Host "Screenshot saved: $path"
    return $path
}

function Set-SellTestCombo([string]$field, [int]$index) {
    $pos = ST-Pos $field
    $maxItems = $ComboMax[$field]
    if (-not $maxItems) { $maxItems = 30 }
    Write-Host "  $field -> index $index (at $($pos[0]),$($pos[1]))"
    [RslhHelper]::SetCombo($pos[0], $pos[1], $index, $maxItems)
}

function Set-SellTestItem($item) {
    # item is a hashtable/PSObject with optional fields:
    #   artifactSet, artifactType, rank, rarity, faction, mainStat, level,
    #   subStat1..4 (dropdown index), value1..4 (numeric)
    Write-Host "Setting Sell Test item..."

    # Reset first
    $resetPos = ST-Pos 'Reset'
    [RslhHelper]::Click($resetPos[0], $resetPos[1])
    Start-Sleep -Milliseconds 500

    # Set combos (only if specified)
    if ($null -ne $item.artifactSet)  { Set-SellTestCombo 'ArtifactSet'  $item.artifactSet }
    if ($null -ne $item.artifactType) { Set-SellTestCombo 'ArtifactType' $item.artifactType }
    if ($null -ne $item.rank)         { Set-SellTestCombo 'Rank'         $item.rank }
    if ($null -ne $item.rarity)       { Set-SellTestCombo 'Rarity'       $item.rarity }
    if ($null -ne $item.faction)      { Set-SellTestCombo 'Faction'      $item.faction }
    if ($null -ne $item.mainStat)     { Set-SellTestCombo 'MainStat'     $item.mainStat }
    if ($null -ne $item.level)        { Set-SellTestCombo 'Level'        $item.level }
    if ($null -ne $item.subStat1)     { Set-SellTestCombo 'SubStat1'     $item.subStat1 }
    if ($null -ne $item.subStat2)     { Set-SellTestCombo 'SubStat2'     $item.subStat2 }
    if ($null -ne $item.subStat3)     { Set-SellTestCombo 'SubStat3'     $item.subStat3 }
    if ($null -ne $item.subStat4)     { Set-SellTestCombo 'SubStat4'     $item.subStat4 }

    # Set numeric values via triple-click (select all) + type
    $valuePairs = @(
        @('Value1', $item.value1),
        @('Value2', $item.value2),
        @('Value3', $item.value3),
        @('Value4', $item.value4)
    )
    foreach ($pair in $valuePairs) {
        if ($null -ne $pair[1]) {
            $pos = ST-Pos $pair[0]
            Write-Host "  $($pair[0]) -> $($pair[1])"
            # Triple-click to select all text in the numeric field
            [RslhHelper]::Click($pos[0], $pos[1])
            Start-Sleep -Milliseconds 100
            [RslhHelper]::Click($pos[0], $pos[1])
            Start-Sleep -Milliseconds 50
            [RslhHelper]::Click($pos[0], $pos[1])
            Start-Sleep -Milliseconds 200
            # Type the value (SendKeys via .NET)
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait("$($pair[1])")
            Start-Sleep -Milliseconds 200
        }
    }

    Start-Sleep -Milliseconds 300
    Write-Host "Item configured."
}

# ── Command dispatch (for server mode) ───────────────────────────────────────

function Invoke-HarnessCommand($cmd) {
    $action = $cmd.action
    $result = @{ ok = $true; action = $action }

    try {
        switch ($action) {
            "ping" {
                $result.message = "pong"
            }
            "get_window_pos" {
                if (Get-WindowPos) {
                    $result.x = $script:WinX
                    $result.y = $script:WinY
                    $result.message = "Window at $($script:WinX),$($script:WinY)"
                } else {
                    $result.ok = $false
                    $result.error = "Failed to get window position"
                }
            }
            "set_sell_test_item" {
                if ($script:WinX -eq 0 -and $script:WinY -eq 0) {
                    if (-not (Get-WindowPos)) {
                        $result.ok = $false
                        $result.error = "Cannot determine window position"
                        break
                    }
                }
                Set-SellTestItem $cmd.item
                $result.message = "Item configured"
            }
            "find" {
                $el = Find-Element -name $cmd.name -className $cmd.className `
                    -parentName $cmd.parentName -automationId $cmd.automationId
                if ($el) {
                    $result.element = $el
                } else {
                    $result.ok = $false
                    $result.error = "Element not found"
                }
            }
            "click" {
                [RslhHelper]::Click($cmd.x, $cmd.y)
                $result.message = "Clicked $($cmd.x),$($cmd.y)"
            }
            "scroll_down" {
                $notches = if ($cmd.notches) { $cmd.notches } else { 1 }
                for ($i = 0; $i -lt $notches; $i++) { [RslhHelper]::ScrollDown(1) }
                $result.message = "Scrolled down $notches"
            }
            "scroll_up" {
                $notches = if ($cmd.notches) { $cmd.notches } else { 1 }
                for ($i = 0; $i -lt $notches; $i++) { [RslhHelper]::ScrollUp(1) }
                $result.message = "Scrolled up $notches"
            }
            "set_combo" {
                $maxScroll = if ($cmd.maxScroll) { $cmd.maxScroll } else { 30 }
                [RslhHelper]::SetCombo($cmd.x, $cmd.y, $cmd.index, $maxScroll)
                $result.message = "Set combo at $($cmd.x),$($cmd.y) to index $($cmd.index)"
            }
            "set_text" {
                [RslhHelper]::SetText($cmd.hwnd, $cmd.text)
                $result.message = "Set text on hwnd $($cmd.hwnd)"
            }
            "screenshot" {
                $w = if ($cmd.w) { $cmd.w } else { 900 }
                $h = if ($cmd.h) { $cmd.h } else { 200 }
                $filename = if ($cmd.filename) { $cmd.filename } else { "screenshot.png" }
                $path = Join-Path $testDir $filename
                [RslhHelper]::Screenshot($cmd.x, $cmd.y, $w, $h, $path)
                $result.path = $path
                $result.message = "Screenshot saved: $path"
            }
            "open_sell_setup" {
                $result.ok = Open-SellSetup
            }
            "click_load_setup" {
                $result.ok = Click-LoadSetup
            }
            "load_hsf" {
                $result.ok = Load-HsfFile $cmd.filePath
            }
            "click_reset" {
                Click-Reset
            }
            "quit" {
                $result.message = "Shutting down"
                return $result  # caller checks for quit
            }
            default {
                $result.ok = $false
                $result.error = "Unknown action: $action"
            }
        }
    } catch {
        $result.ok = $false
        $result.error = $_.Exception.Message
    }
    return $result
}

# ── Server mode: poll command file ───────────────────────────────────────────

if (-not $interactive) {
    $cmdFile = Join-Path $testDir "harness-cmd.json"
    $resultFile = Join-Path $testDir "harness-result.json"
    $readyFile = Join-Path $testDir "harness-ready"

    # Clean up stale files
    if (Test-Path $cmdFile) { Remove-Item $cmdFile }
    if (Test-Path $resultFile) { Remove-Item $resultFile }

    # Signal that we're ready
    "ready" | Out-File -FilePath $readyFile -Encoding utf8
    Write-Host ""
    Write-Host "=== RSL Helper Test Harness (Server Mode) ==="
    Write-Host "PID:        $targetPid"
    Write-Host "Test dir:   $testDir"
    Write-Host "Command:    $cmdFile"
    Write-Host "Result:     $resultFile"
    Write-Host "Ready file: $readyFile"
    Write-Host ""
    Write-Host "Waiting for commands... (write JSON to $cmdFile)"
    Write-Host ""

    while ($true) {
        if (Test-Path $cmdFile) {
            try {
                $raw = Get-Content $cmdFile -Raw -Encoding UTF8
                Remove-Item $cmdFile
                $cmd = $raw | ConvertFrom-Json
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Action: $($cmd.action)"

                $result = Invoke-HarnessCommand $cmd
                $resultJson = ConvertTo-Json $result -Compress -Depth 5
                $resultJson | Out-File -FilePath $resultFile -Encoding utf8

                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Result: ok=$($result.ok)"

                if ($cmd.action -eq "quit") {
                    Write-Host "Goodbye."
                    if (Test-Path $readyFile) { Remove-Item $readyFile }
                    break
                }
            } catch {
                $errResult = @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
                $errResult | Out-File -FilePath $resultFile -Encoding utf8
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $($_.Exception.Message)"
            }
        }
        Start-Sleep -Milliseconds 200
    }
} else {
    # Interactive mode — just print status, user calls functions directly
    Write-Host ""
    Write-Host "=== RSL Helper Test Harness (Interactive) ==="
    Write-Host "PID:       $targetPid"
    Write-Host "Test dir:  $testDir"
    Write-Host ""
    Write-Host "Available functions:"
    Write-Host "  Find-Element -name <name> [-className <cls>] [-parentName <parent>]"
    Write-Host "  [RslhHelper]::Click(x, y)"
    Write-Host "  [RslhHelper]::SetCombo(comboX, comboY, itemIndex, maxScroll)"
    Write-Host "  [RslhHelper]::ScrollUp(notches) / ScrollDown(notches)"
    Write-Host "  [RslhHelper]::Screenshot(x, y, w, h, path)"
    Write-Host "  Open-SellSetup / Click-LoadSetup / Load-HsfFile / Click-Reset"
    Write-Host "  Take-Screenshot -filename <name> [-x X] [-y Y] [-w W] [-h H]"
    Write-Host ""
}

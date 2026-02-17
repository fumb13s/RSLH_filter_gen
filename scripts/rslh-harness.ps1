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

    public static void SetCombo(int comboX, int comboY, int itemIndex) {
        // Click to open dropdown.
        // Assumes selection starts at index 0 (after Reset), so items 0..(VISIBLE-1)
        // are visible immediately — no scroll-to-top needed.
        Click(comboX, comboY);
        Thread.Sleep(300);

        if (itemIndex < DD_VISIBLE_COUNT) {
            // Target is visible without scrolling — click directly
            int clickY = comboY + DD_FIRST_OFFSET + itemIndex * DD_ITEM_HEIGHT;
            Click(comboX, clickY);
        } else {
            // Move cursor into dropdown so scroll moves the viewport (not highlight)
            SetCursorPos(comboX, comboY + DD_FIRST_OFFSET);
            Thread.Sleep(100);

            // Scroll viewport down just enough to make target the bottom visible item.
            // Each tick shifts the viewport by 1 item.
            int scrollCount = itemIndex - (DD_VISIBLE_COUNT - 1);
            for (int i = 0; i < scrollCount; i++) { ScrollDown(1); }
            Thread.Sleep(200);

            // Target is now at the bottom row
            int clickY = comboY + DD_FIRST_OFFSET + (DD_VISIBLE_COUNT - 1) * DD_ITEM_HEIGHT;
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
    SellTestOpen = @(1217, 816)
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

# ── Abort sentinel ────────────────────────────────────────────────────────────

$script:StopFile = Join-Path $testDir "harness-stop"

function Check-Abort {
    if (Test-Path $script:StopFile) {
        Write-Host "[ABORT] Stop sentinel detected — aborting operation"
        Remove-Item $script:StopFile -ErrorAction SilentlyContinue
        throw "ABORT: harness-stop sentinel"
    }
}

# ── High-level actions ───────────────────────────────────────────────────────

function Open-SellSetup {
    # Idempotent: check if already open by looking for Load Setup button
    $check = Find-Element -name 'Load Setup'
    if ($check) {
        Write-Host "Sell Setup already open."
        return $true
    }
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
    if (-not $el) { Write-Host "  FAIL: Load Setup button not found"; return $false }
    [RslhHelper]::Click($el.cx, $el.cy)
    Start-Sleep -Milliseconds 1500  # file dialog needs time to fully render
    return $true
}

function Load-HsfFile([string]$filePath) {
    Write-Host "Loading .hsf file: $filePath"

    # Find the Edit control in the file dialog
    # Note: skip parentName — #32770 dialogs don't resolve reliably and it's slow
    $edit = Find-Element -className 'Edit'
    if (-not $edit) { Write-Host "  FAIL: Edit control not found"; return $false }
    Write-Host "  Found Edit at hwnd=$($edit.hwnd)"

    # Find the Open button
    $btn = Find-Element -name 'Open' -className 'Button'
    if (-not $btn) { Write-Host "  FAIL: Open button not found"; return $false }
    Write-Host "  Found Open at cx=$($btn.cx), cy=$($btn.cy)"

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
    Write-Host "  $field -> index $index (at $($pos[0]),$($pos[1]))"
    [RslhHelper]::SetCombo($pos[0], $pos[1], $index)
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

    # Set combos (only if specified), checking abort sentinel between each
    if ($null -ne $item.artifactSet)  { Check-Abort; Set-SellTestCombo 'ArtifactSet'  $item.artifactSet }
    if ($null -ne $item.artifactType) { Check-Abort; Set-SellTestCombo 'ArtifactType' $item.artifactType }
    if ($null -ne $item.rank)         { Check-Abort; Set-SellTestCombo 'Rank'         $item.rank }
    if ($null -ne $item.rarity)       { Check-Abort; Set-SellTestCombo 'Rarity'       $item.rarity }
    if ($null -ne $item.faction)      { Check-Abort; Set-SellTestCombo 'Faction'      $item.faction }
    if ($null -ne $item.mainStat)     { Check-Abort; Set-SellTestCombo 'MainStat'     $item.mainStat }
    if ($null -ne $item.level)        { Check-Abort; Set-SellTestCombo 'Level'        $item.level }
    if ($null -ne $item.subStat1)     { Check-Abort; Set-SellTestCombo 'SubStat1'     $item.subStat1 }
    if ($null -ne $item.subStat2)     { Check-Abort; Set-SellTestCombo 'SubStat2'     $item.subStat2 }
    if ($null -ne $item.subStat3)     { Check-Abort; Set-SellTestCombo 'SubStat3'     $item.subStat3 }
    if ($null -ne $item.subStat4)     { Check-Abort; Set-SellTestCombo 'SubStat4'     $item.subStat4 }

    # Set numeric values.
    # The value fields shrink when the item preview appears, so find the
    # actual X position dynamically via UIAutomation, then use known Y offsets.
    $valuePairs = @(
        @('Value1', $item.value1),
        @('Value2', $item.value2),
        @('Value3', $item.value3),
        @('Value4', $item.value4)
    )
    $hasValues = $false
    foreach ($pair in $valuePairs) { if ($null -ne $pair[1]) { $hasValues = $true; break } }

    if ($hasValues) {
        # Find one NumericEdit to get the actual column X center
        $numEdit = Find-Element -className 'TscGPNumericEdit'
        if ($numEdit) {
            $valX = [int]$numEdit.cx
            Write-Host "  Value field X center: $valX (found via UIAutomation)"
        } else {
            $valX = (ST-Pos 'Value1')[0]
            Write-Warning "  NumericEdit not found, using hardcoded X: $valX"
        }

        Add-Type -AssemblyName System.Windows.Forms
        foreach ($pair in $valuePairs) {
            if ($null -ne $pair[1]) {
                $valY = (ST-Pos $pair[0])[1]
                Write-Host "  $($pair[0]) -> $($pair[1]) (at $valX,$valY)"
                # Click to focus, Ctrl+A to select all, then type the value
                [RslhHelper]::Click($valX, $valY)
                Start-Sleep -Milliseconds 100
                [System.Windows.Forms.SendKeys]::SendWait("^a")
                Start-Sleep -Milliseconds 100
                [System.Windows.Forms.SendKeys]::SendWait("$($pair[1])")
                Start-Sleep -Milliseconds 200
            }
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
            "read_status" {
                if ($script:WinX -eq 0 -and $script:WinY -eq 0) {
                    if (-not (Get-WindowPos)) {
                        $result.ok = $false
                        $result.error = "Cannot determine window position"
                        break
                    }
                }
                $statusPos = ST-Pos 'StatusLabel'
                $path = Join-Path $testDir "status.png"
                # Capture the full status bar (wide enough for OCR)
                [RslhHelper]::Screenshot($script:WinX + 430, $statusPos[1] - 5, 600, 25, $path)
                $result.path = $path
                $result.message = "Status screenshot saved"
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
                [RslhHelper]::SetCombo($cmd.x, $cmd.y, $cmd.index)
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
            "open_sell_test" {
                if ($script:WinX -eq 0 -and $script:WinY -eq 0) {
                    if (-not (Get-WindowPos)) {
                        $result.ok = $false
                        $result.error = "Cannot determine window position"
                        break
                    }
                }
                # The Sell Test toggle is the arrow at SellTestOpen offset (when closed).
                # When the panel opens, the "Sell Test" label moves up (~816 -> ~676 relative Y).
                # RSL Helper bug: may need two clicks if Sell Setup was reopened.
                $closedRelY = 816
                for ($attempt = 0; $attempt -lt 3; $attempt++) {
                    $label = Find-Element -name 'Sell Test'
                    if (-not $label) {
                        $result.ok = $false
                        $result.error = "Sell Test label not found"
                        break
                    }
                    $relY = $label.cy - $script:WinY
                    if ($relY -lt ($closedRelY - 50)) {
                        # Label moved up — panel is open
                        $result.message = "Sell Test panel open (label at relY=$relY)"
                        break
                    }
                    # Panel is closed — click the arrow (same Y as label, X from offset)
                    $arrowX = $script:WinX + ($ST['SellTestOpen'])[0]
                    [RslhHelper]::Click($arrowX, $label.cy)
                    Start-Sleep -Milliseconds 800
                    Write-Host "  Sell Test click $($attempt + 1) at $arrowX,$($label.cy)"
                }
                # Final check
                if ($result.ok -ne $false -and -not $result.message) {
                    $label = Find-Element -name 'Sell Test'
                    $relY = if ($label) { $label.cy - $script:WinY } else { $closedRelY }
                    if ($relY -lt ($closedRelY - 50)) {
                        $result.message = "Sell Test panel opened after retries"
                    } else {
                        $result.ok = $false
                        $result.error = "Sell Test panel did not open after 3 attempts"
                    }
                }
            }
            "click_load_setup" {
                $result.ok = Click-LoadSetup
            }
            "load_hsf" {
                $fp = $cmd.filePath
                if (-not $fp) { $fp = $cmd.path }
                if (-not $fp) {
                    $result.ok = $false
                    $result.error = "No filePath or path specified"
                } else {
                    # Click Load Setup to open the file dialog
                    $null = Click-LoadSetup
                    # Find Edit and Open button
                    $edit = Find-Element -className 'Edit'
                    $btn  = Find-Element -name 'Open' -className 'Button'
                    if (-not $edit) {
                        $result.ok = $false
                        $result.error = "Edit control not found in file dialog"
                    } elseif (-not $btn) {
                        $result.ok = $false
                        $result.error = "Open button not found in file dialog"
                    } else {
                        [RslhHelper]::SetText($edit.hwnd, $fp)
                        Start-Sleep -Milliseconds 300
                        [RslhHelper]::Click($btn.cx, $btn.cy)
                        Start-Sleep -Milliseconds 500
                        $result.ok = $true
                    }
                }
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
        # Check abort sentinel
        if (Test-Path $script:StopFile) {
            Write-Host "[ABORT] Stop sentinel detected — shutting down"
            Remove-Item $script:StopFile -ErrorAction SilentlyContinue
            if (Test-Path $readyFile) { Remove-Item $readyFile }
            break
        }
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
                # If aborted, shut down
                if ($_.Exception.Message -like "*harness-stop sentinel*") {
                    Write-Host "Shutting down after abort."
                    if (Test-Path $readyFile) { Remove-Item $readyFile }
                    break
                }
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

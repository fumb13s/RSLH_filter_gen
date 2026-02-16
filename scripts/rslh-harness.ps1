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
    public static void SetCombo(int comboX, int comboY, int itemIndex, int maxScroll) {
        // Click to open dropdown
        Click(comboX, comboY);
        Thread.Sleep(300);

        // Scroll up to reach the top
        for (int i = 0; i < maxScroll; i++) { ScrollUp(1); }
        Thread.Sleep(200);

        // Scroll down to desired item
        for (int i = 0; i < itemIndex; i++) { ScrollDown(1); }
        Thread.Sleep(200);

        // Click the highlighted item (dropdown appears just below combo)
        Click(comboX, comboY + 30);
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

# ── UIAutomation helper (calls find-ui.ps1 as a non-elevated child) ──────────

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

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

# ── Command dispatch (for server mode) ───────────────────────────────────────

function Invoke-HarnessCommand($cmd) {
    $action = $cmd.action
    $result = @{ ok = $true; action = $action }

    try {
        switch ($action) {
            "ping" {
                $result.message = "pong"
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

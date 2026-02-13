# Load an .hsf file via RSL Helper's Open dialog.
# Phase 1: Find edit HWND + Open button coords via UIAutomation (non-elevated)
# Phase 2: WM_SETTEXT + mouse click (elevated, no UIAutomation)
param(
    [Parameter(Mandatory=$true)][string]$filePath,
    [int]$targetPid = 34600
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
$window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)

if (-not $window) {
    Write-Error "Window not found for PID $targetPid"
    exit 1
}

# Find the Open dialog
$openDlg = $window.FindFirst(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, 'Open')))

if (-not $openDlg) {
    Write-Error "Open file dialog not found"
    exit 1
}

# Find the filename Edit control HWND
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit')
$editBox = $openDlg.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants, $editCondition)

if (-not $editBox) {
    Write-Error "Filename edit box not found"
    exit 1
}

$editHwnd = $editBox.Current.NativeWindowHandle
Write-Output "Edit HWND: $editHwnd (current: '$($editBox.Current.Name)')"

# Find the Open button coordinates
$btnCondition = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, 'Open')),
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Button')))
$openBtn = $openDlg.FindFirst(
    [System.Windows.Automation.TreeScope]::Children, $btnCondition)

if (-not $openBtn) {
    Write-Error "Open button not found"
    exit 1
}

$btnRect = $openBtn.Current.BoundingRectangle
$openX = [int]($btnRect.X + $btnRect.Width / 2)
$openY = [int]($btnRect.Y + $btnRect.Height / 2)
Write-Output "Open button at: $openX,$openY"

# Phase 2: elevated WM_SETTEXT + click
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$elevatedScript = Join-Path $scriptDir "load-hsf-elevated.ps1"

Write-Output "Loading: $filePath"
Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList `
    '-ExecutionPolicy', 'Bypass', '-File', $elevatedScript, `
    '-filePath', $filePath, `
    '-editHwnd', $editHwnd, `
    '-openX', $openX, '-openY', $openY

Write-Output "Done."

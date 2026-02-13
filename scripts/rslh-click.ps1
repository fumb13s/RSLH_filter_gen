# RSL Helper UI automation: find an element by name (and optional class) and click it.
# Uses UIAutomation to find coordinates, then spawns an elevated process to click.
param(
    [Parameter(Mandatory=$true)][string]$elementName,
    [string]$className,
    [int]$targetPid = 34600
)

# Step 1: Find element coordinates via UIAutomation
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

if ($className) {
    $searchCondition = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, $elementName)),
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty, $className)))
} else {
    $searchCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $elementName)
}

$el = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $searchCondition)

if (-not $el) {
    Write-Error "Element '$elementName' (class: $className) not found"
    exit 1
}

$rect = $el.Current.BoundingRectangle
$cx = [int]($rect.X + $rect.Width / 2)
$cy = [int]($rect.Y + $rect.Height / 2)
Write-Output "Found '$elementName' at $cx,$cy"

# Step 2: Click via elevated process
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$clickScript = Join-Path $scriptDir "click.ps1"

Write-Output "Clicking (elevated)..."
Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList `
    '-ExecutionPolicy', 'Bypass', '-File', $clickScript, '-x', $cx, '-y', $cy

Write-Output "Done."

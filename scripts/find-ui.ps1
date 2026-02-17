# Non-elevated UIAutomation element finder.
# Outputs JSON for machine consumption by the elevated orchestrator.
# Usage:
#   find-ui.ps1 -targetPid <PID> -name "Sell Setup"
#   find-ui.ps1 -targetPid <PID> -name "Open" -className "Button"
#   find-ui.ps1 -targetPid <PID> -name "Open" -className "Button" -parentName "Open"
#   find-ui.ps1 -targetPid <PID> -className "Edit" -parentName "Open"
param(
    [Parameter(Mandatory=$true)][int]$targetPid,
    [string]$name,
    [string]$className,
    [string]$parentName,
    [string]$automationId
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Make-Result($ok, $data) {
    $data["ok"] = $ok
    ConvertTo-Json $data -Compress
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$pidCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
# FindAll: a process can have multiple top-level windows (e.g. main window + file dialog)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCond)

if (-not $windows -or $windows.Count -eq 0) {
    Write-Output (Make-Result $false @{ error = "Window not found for PID $targetPid" })
    exit 1
}

# Build search condition
$conditions = @()
if ($name) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $name)
}
if ($className) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, $className)
}
if ($automationId) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $automationId)
}

if ($conditions.Count -eq 0) {
    Write-Output (Make-Result $false @{ error = "No search criteria specified" })
    exit 1
}

if ($conditions.Count -eq 1) {
    $searchCond = $conditions[0]
} else {
    $searchCond = New-Object System.Windows.Automation.AndCondition($conditions)
}

# Search all top-level windows for this PID (handles dialogs as separate windows)
$el = $null
foreach ($window in $windows) {
    $searchRoot = $window
    if ($parentName) {
        $parentCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, $parentName)
        $searchRoot = $window.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants, $parentCond)
        if (-not $searchRoot) {
            $searchRoot = $window.FindFirst(
                [System.Windows.Automation.TreeScope]::Children, $parentCond)
        }
        if (-not $searchRoot) { continue }
    }
    $el = $searchRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $searchCond)
    if ($el) { break }
}

if (-not $el) {
    $desc = @()
    if ($name) { $desc += "name='$name'" }
    if ($className) { $desc += "class='$className'" }
    if ($automationId) { $desc += "id='$automationId'" }
    $descStr = $desc -join ", "
    Write-Output (Make-Result $false @{ error = "Element not found: $descStr" })
    exit 1
}

$rect = $el.Current.BoundingRectangle
$cx = [int]($rect.X + $rect.Width / 2)
$cy = [int]($rect.Y + $rect.Height / 2)
$hwnd = $el.Current.NativeWindowHandle

Write-Output (Make-Result $true @{
    x      = [int]$rect.X
    y      = [int]$rect.Y
    width  = [int]$rect.Width
    height = [int]$rect.Height
    cx     = $cx
    cy     = $cy
    hwnd   = $hwnd
    name   = $el.Current.Name
    class  = $el.Current.ClassName
})

# Dump the UI tree of RSL Helper (after Sell Setup is open)
param([int]$targetPid = 34600, [int]$maxDepth = 5)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)

# Check all top-level windows (Sell Setup might be a new window)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
Write-Output "Windows from PID ${targetPid}: $($windows.Count)"

function Dump-Tree($el, $depth) {
    if ($depth -gt $maxDepth) { return }
    $indent = "  " * $depth
    $name = $el.Current.Name
    $type = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
    $cls = $el.Current.ClassName
    $rect = $el.Current.BoundingRectangle
    $w = [int]$rect.Width
    $h = [int]$rect.Height
    if ($name -or $depth -le 2) {
        Write-Output "$indent[$type] '$name' ($cls) ${w}x${h}"
    }
    $children = $el.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) {
        Dump-Tree $child ($depth + 1)
    }
}

foreach ($w in $windows) {
    Write-Output ""
    Write-Output "=== Window: '$($w.Current.Name)' ($($w.Current.ClassName)) ==="
    Dump-Tree $w 0
}

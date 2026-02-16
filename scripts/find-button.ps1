# Find Sell Setup button coordinates using UIAutomation
param([int]$targetPid = 34600)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
$window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)

if (-not $window) {
    Write-Output "Window not found for PID $targetPid"
    exit 1
}

$winRect = $window.Current.BoundingRectangle
Write-Output "Window: X=$([int]$winRect.X) Y=$([int]$winRect.Y) W=$([int]$winRect.Width) H=$([int]$winRect.Height)"

$nameCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, 'Sell Setup')
$btn = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCondition)

if ($btn) {
    $rect = $btn.Current.BoundingRectangle
    $cx = [int]($rect.X + $rect.Width / 2)
    $cy = [int]($rect.Y + $rect.Height / 2)
    Write-Output "Sell Setup: X=$([int]$rect.X) Y=$([int]$rect.Y) W=$([int]$rect.Width) H=$([int]$rect.Height)"
    Write-Output "Center: $cx,$cy"
} else {
    Write-Output "Sell Setup button not found"
}

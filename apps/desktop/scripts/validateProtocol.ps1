param(
  [string]$Scheme = "omni"
)

$ErrorActionPreference = "Stop"

$registryPath = "HKCU:\Software\Classes\$Scheme"
$commandPath = "$registryPath\shell\open\command"

if (-not (Test-Path $registryPath)) {
  Write-Error "Protocol is not registered: $Scheme"
  exit 1
}

if (-not (Test-Path $commandPath)) {
  Write-Error "Protocol command key missing: $commandPath"
  exit 1
}

$command = (Get-ItemProperty -Path $commandPath)."(default)"
if ([string]::IsNullOrWhiteSpace($command)) {
  Write-Error "Protocol command is empty."
  exit 1
}

Write-Host "Protocol registration looks valid."
Write-Host "Scheme: $Scheme"
Write-Host "Command: $command"
exit 0

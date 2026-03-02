param(
  [string]$Scheme = "omni",
  [string]$ExecutablePath,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopRoot = Resolve-Path (Join-Path $scriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $desktopRoot "..\..")
$registryPath = "HKCU:\Software\Classes\$Scheme"

function Get-DefaultExecutablePath {
  param([string]$DesktopRoot)

  $candidates = @(
    (Join-Path $DesktopRoot "out\win-unpacked\Omni.exe"),
    (Join-Path $DesktopRoot "out\Omni.exe")
  )

  foreach ($packaged in $candidates) {
    if (Test-Path $packaged) {
      return (Resolve-Path $packaged).Path
    }
  }

  $electronCmd = Join-Path $repoRoot "node_modules\.bin\electron.cmd"
  if (Test-Path $electronCmd) {
    return "`"$electronCmd`" `"$desktopRoot`""
  }

  throw "No executable found. Pass -ExecutablePath to this script (path to Omni.exe)."
}

if ($Unregister) {
  if (Test-Path $registryPath) {
    Remove-Item $registryPath -Recurse -Force
    Write-Host "Removed protocol registration: $Scheme"
  } else {
    Write-Host "Protocol not registered: $Scheme"
  }
  exit 0
}

$effectivePath = if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
  Get-DefaultExecutablePath -DesktopRoot $desktopRoot
} else {
  $ExecutablePath
}

if (-not (Test-Path (Split-Path $effectivePath -Parent)) -and -not $effectivePath.Contains("electron.cmd")) {
  throw "Invalid executable path: $effectivePath"
}

New-Item -Path $registryPath -Force | Out-Null
Set-ItemProperty -Path $registryPath -Name "(Default)" -Value "URL:Omni Link"
Set-ItemProperty -Path $registryPath -Name "URL Protocol" -Value ""

New-Item -Path "$registryPath\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$registryPath\DefaultIcon" -Name "(Default)" -Value $effectivePath

New-Item -Path "$registryPath\shell\open\command" -Force | Out-Null
$command = "$effectivePath `"%1`""
Set-ItemProperty -Path "$registryPath\shell\open\command" -Name "(Default)" -Value $command

Write-Host "Registered protocol: $Scheme"
Write-Host "Command: $command"

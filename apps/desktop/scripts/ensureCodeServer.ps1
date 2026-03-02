param(
  [switch]$ForceRefresh
)

$ErrorActionPreference = "Stop"

$fallbackVersion = "4.108.2"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopRoot = Split-Path -Parent $scriptRoot
$vendorRoot = Join-Path $desktopRoot "vendor"
$runtimeRoot = Join-Path $vendorRoot "code-server"
$entryPath = Join-Path $runtimeRoot "out\node\entry.js"
$loggerPackage = Join-Path $runtimeRoot "node_modules\@coder\logger\package.json"
$runtimePackageJsonPath = Join-Path $runtimeRoot "package.json"

function Write-Info {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Output $Message
}

function Write-Warn {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Output "[warning] $Message"
}

function Get-CodeServerVersionFromRuntime {
  param([Parameter(Mandatory = $true)][string]$RuntimePackageJsonPath)

  if (-not (Test-Path $RuntimePackageJsonPath)) {
    return $null
  }

  try {
    $runtimePackage = Get-Content -Raw -Path $RuntimePackageJsonPath | ConvertFrom-Json
    if ($runtimePackage.version) {
      return [string]$runtimePackage.version
    }
  } catch {
    return $null
  }

  return $null
}

function Get-LatestCodeServerVersion {
  try {
    $latest = npm view code-server version --silent
    if ($LASTEXITCODE -ne 0) {
      return $null
    }

    $latest = [string]$latest
    if ([string]::IsNullOrWhiteSpace($latest)) {
      return $null
    }

    return $latest.Trim()
  } catch {
    return $null
  }
}

function Convert-VersionForCompare {
  param([Parameter(Mandatory = $true)][string]$Version)

  $normalized = ($Version -split "-")[0]
  $parts = $normalized.Split(".")
  $numbers = @()

  foreach ($part in $parts) {
    $value = 0
    if ([int]::TryParse($part, [ref]$value)) {
      $numbers += $value
    } else {
      $numbers += 0
    }
  }

  while ($numbers.Count -lt 4) {
    $numbers += 0
  }

  return [Version]::new($numbers[0], $numbers[1], $numbers[2], $numbers[3])
}

function Should-UpdateCodeServer {
  param(
    [Parameter(Mandatory = $true)][string]$CurrentVersion,
    [Parameter(Mandatory = $true)][string]$TargetVersion
  )

  try {
    $current = Convert-VersionForCompare -Version $CurrentVersion
    $target = Convert-VersionForCompare -Version $TargetVersion
    return $target -gt $current
  } catch {
    return $false
  }
}

function Install-CodeServerVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$VendorRoot,
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string]$EntryPath
  )

  $tempTgz = Join-Path $VendorRoot "code-server-$Version.tgz"
  $extractRoot = Join-Path $VendorRoot "_extract"
  $extractPackageRoot = Join-Path $extractRoot "package"

  if (Test-Path $extractRoot) {
    Remove-Item -Path $extractRoot -Recurse -Force
  }

  $url = "https://registry.npmjs.org/code-server/-/code-server-$Version.tgz"
  Write-Info "[ensureCodeServer] downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $tempTgz

  Write-Info "[ensureCodeServer] extracting archive"
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  tar -xzf $tempTgz -C $extractRoot

  if (-not (Test-Path $extractPackageRoot)) {
    throw "Extracted package directory not found: $extractPackageRoot"
  }

  if (Test-Path $RuntimeRoot) {
    try {
      Remove-Item -Path $RuntimeRoot -Recurse -Force
    } catch {
      throw "RUNTIME_LOCKED: Unable to replace code-server runtime at $RuntimeRoot. Close running Omni/Electron instances and retry. $($_.Exception.Message)"
    }
  }

  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $extractPackageRoot "*") -Destination $RuntimeRoot -Recurse -Force
  Remove-Item -Path $extractRoot -Recurse -Force
  Remove-Item -Path $tempTgz -Force

  if (-not (Test-Path $EntryPath)) {
    throw "code-server entry not found after extraction: $EntryPath"
  }

  Write-Info "[ensureCodeServer] installing runtime dependencies"
  Push-Location $RuntimeRoot
  try {
    npm install --omit=dev --ignore-scripts
  } finally {
    Pop-Location
  }
}

function Get-PackageJsonPath {
  param(
    [Parameter(Mandatory = $true)][string]$NodeModulesRoot,
    [Parameter(Mandatory = $true)][string]$PackageName
  )

  $packagePath = Join-Path $NodeModulesRoot $PackageName.Replace("/", "\\")
  return Join-Path $packagePath "package.json"
}

function Get-MissingManifestPackages {
  param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$NodeModulesRoot
  )

  if (-not (Test-Path $ManifestPath)) {
    throw "Manifest not found: $ManifestPath"
  }

  $manifest = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
  $missing = @()

  if ($manifest.dependencies) {
    foreach ($property in $manifest.dependencies.PSObject.Properties) {
      $packageName = $property.Name
      $packageVersion = [string]$property.Value
      $packageJsonPath = Get-PackageJsonPath -NodeModulesRoot $NodeModulesRoot -PackageName $packageName

      if (-not (Test-Path $packageJsonPath)) {
        $missing += "$packageName@$packageVersion"
      }
    }
  }

  return $missing
}

function Install-PackagesIfMissing {
  param(
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string[]]$ManifestPaths
  )

  $runtimeNodeModules = Join-Path $RuntimeRoot "node_modules"
  $missingDeps = @()

  foreach ($manifestPath in $ManifestPaths) {
    $missingDeps += Get-MissingManifestPackages -ManifestPath $manifestPath -NodeModulesRoot $runtimeNodeModules
  }

  $missingDeps = @($missingDeps | Sort-Object -Unique)

  if ($missingDeps.Count -gt 0) {
    Write-Info "[ensureCodeServer] installing missing dependencies: $($missingDeps -join ', ')"
    Push-Location $RuntimeRoot
    try {
      npm install --omit=dev --ignore-scripts @missingDeps
    } finally {
      Pop-Location
    }
  }

  foreach ($manifestPath in $ManifestPaths) {
    $remaining = Get-MissingManifestPackages -ManifestPath $manifestPath -NodeModulesRoot $runtimeNodeModules
    if ($remaining.Count -gt 0) {
      throw "Missing dependencies after install for ${manifestPath}: $($remaining -join ', ')"
    }
  }
}

function Ensure-NodeGypPythonCompatibility {
  try {
    python -c "import distutils" | Out-Null
    return
  } catch {
    Write-Info "[ensureCodeServer] python distutils missing, installing setuptools for node-gyp compatibility"
    python -m pip install --user setuptools | Out-Null
  }
}

function Get-NativePackagesMissingBinary {
  param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$NodeModulesRoot
  )

  if (-not (Test-Path $ManifestPath)) {
    return @()
  }

  $manifest = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
  $nativeMissing = @()

  if ($manifest.dependencies) {
    foreach ($property in $manifest.dependencies.PSObject.Properties) {
      $packageName = $property.Name
      $packageDir = Join-Path $NodeModulesRoot $packageName.Replace("/", "\\")
      $bindingGyp = Join-Path $packageDir "binding.gyp"

      if (-not (Test-Path $bindingGyp)) {
        continue
      }

      $nodeBinaries = @(Get-ChildItem -Path $packageDir -Recurse -Filter "*.node" -File -ErrorAction SilentlyContinue)

      if ($nodeBinaries.Count -eq 0) {
        $nativeMissing += $packageName
      }
    }
  }

  return $nativeMissing
}

function Rebuild-NativePackagesIfNeeded {
  param(
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string[]]$ManifestPaths
  )

  $runtimeNodeModules = Join-Path $RuntimeRoot "node_modules"
  $packagesToRebuild = @()

  foreach ($manifestPath in $ManifestPaths) {
    $packagesToRebuild += Get-NativePackagesMissingBinary -ManifestPath $manifestPath -NodeModulesRoot $runtimeNodeModules
  }

  $packagesToRebuild = @($packagesToRebuild | Sort-Object -Unique)
  if ($packagesToRebuild.Count -eq 0) {
    return
  }

  Write-Info "[ensureCodeServer] rebuilding native packages: $($packagesToRebuild -join ', ')"
  Ensure-NodeGypPythonCompatibility

  Push-Location $RuntimeRoot
  try {
    npm rebuild @packagesToRebuild
  } finally {
    Pop-Location
  }

  $remainingNativeMissing = @()
  foreach ($manifestPath in $ManifestPaths) {
    $remainingNativeMissing += Get-NativePackagesMissingBinary -ManifestPath $manifestPath -NodeModulesRoot $runtimeNodeModules
  }

  $remainingNativeMissing = @($remainingNativeMissing | Sort-Object -Unique)
  if ($remainingNativeMissing.Count -gt 0) {
    $criticalPackages = @("@vscode/windows-registry")
    $criticalMissing = @($remainingNativeMissing | Where-Object { $criticalPackages -contains $_ })

    if ($criticalMissing.Count -gt 0) {
      throw "Critical native binaries still missing after rebuild: $($criticalMissing -join ', ')"
    }

    Write-Warn "Native binaries still missing for non-critical packages: $($remainingNativeMissing -join ', ')"
  }
}

function Apply-RuntimeSecurityPatches {
  param(
    [Parameter(Mandatory = $true)][string]$RuntimeRoot
  )

  $securityPatches = @(
    "qs@6.15.0",
    "basic-ftp@5.2.0"
  )

  Write-Info "[ensureCodeServer] applying security patches: $($securityPatches -join ', ')"
  Push-Location $RuntimeRoot
  try {
    npm install --omit=dev --ignore-scripts @securityPatches
  } finally {
    Pop-Location
  }
}

$isRuntimePresent = (Test-Path $entryPath) -and (Test-Path $loggerPackage)
$manifestPaths = @(
  (Join-Path $runtimeRoot "package.json"),
  (Join-Path $runtimeRoot "lib\vscode\package.json")
)
$currentVersion = Get-CodeServerVersionFromRuntime -RuntimePackageJsonPath $runtimePackageJsonPath
$latestVersion = Get-LatestCodeServerVersion
$targetVersion = if ($latestVersion) { $latestVersion } else { $fallbackVersion }

if ($latestVersion) {
  Write-Info "[ensureCodeServer] latest npm code-server: $latestVersion"
} else {
  Write-Warn "[ensureCodeServer] unable to resolve latest version from npm, falling back to $fallbackVersion"
}

$needsInstall = -not $isRuntimePresent
$needsUpdate = $false
if ($isRuntimePresent -and $currentVersion) {
  $needsUpdate = Should-UpdateCodeServer -CurrentVersion $currentVersion -TargetVersion $targetVersion
}

if ($ForceRefresh) {
  Write-Info "[ensureCodeServer] force refresh requested"
  $needsInstall = $true
}

if ($isRuntimePresent -and -not $currentVersion) {
  Write-Warn "[ensureCodeServer] runtime present but version missing/unreadable, forcing reinstall"
  $needsInstall = $true
}

if ($needsInstall -or $needsUpdate) {
  New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
  if ($needsUpdate) {
    Write-Info "[ensureCodeServer] updating runtime from $currentVersion to $targetVersion"
  } else {
    Write-Info "[ensureCodeServer] installing runtime version $targetVersion"
  }

  try {
    Install-CodeServerVersion -Version $targetVersion -VendorRoot $vendorRoot -RuntimeRoot $runtimeRoot -EntryPath $entryPath
  } catch {
    $message = [string]$_.Exception.Message
    if (-not $ForceRefresh -and $needsUpdate -and $message.StartsWith("RUNTIME_LOCKED:")) {
      Write-Warn "[ensureCodeServer] update skipped because runtime is in use. $message"
      Write-Warn "[ensureCodeServer] continuing with existing runtime version $currentVersion"
    } else {
      throw
    }
  }
} else {
  Write-Info "[ensureCodeServer] code-server runtime up-to-date ($currentVersion), verifying all declared dependencies"
}

Install-PackagesIfMissing -RuntimeRoot $runtimeRoot -ManifestPaths $manifestPaths
Rebuild-NativePackagesIfNeeded -RuntimeRoot $runtimeRoot -ManifestPaths $manifestPaths
Apply-RuntimeSecurityPatches -RuntimeRoot $runtimeRoot

if (-not (Test-Path $loggerPackage)) {
  throw "code-server dependencies missing after install: $loggerPackage"
}

Write-Info "[ensureCodeServer] ready: $entryPath"

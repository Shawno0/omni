$ErrorActionPreference = "Stop"

$version = "4.108.2"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopRoot = Split-Path -Parent $scriptRoot
$vendorRoot = Join-Path $desktopRoot "vendor"
$runtimeRoot = Join-Path $vendorRoot "code-server"
$entryPath = Join-Path $runtimeRoot "out\node\entry.js"
$loggerPackage = Join-Path $runtimeRoot "node_modules\@coder\logger\package.json"

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
    Write-Host "[ensureCodeServer] installing missing dependencies: $($missingDeps -join ', ')"
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
    Write-Host "[ensureCodeServer] python distutils missing, installing setuptools for node-gyp compatibility"
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

  Write-Host "[ensureCodeServer] rebuilding native packages: $($packagesToRebuild -join ', ')"
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

    Write-Warning "Native binaries still missing for non-critical packages: $($remainingNativeMissing -join ', ')"
  }
}

$isRuntimePresent = (Test-Path $entryPath) -and (Test-Path $loggerPackage)
$manifestPaths = @(
  (Join-Path $runtimeRoot "package.json"),
  (Join-Path $runtimeRoot "lib\vscode\package.json")
)

if (-not $isRuntimePresent) {
  New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
  $tempTgz = Join-Path $vendorRoot "code-server-$version.tgz"
  $extractRoot = Join-Path $vendorRoot "_extract"
  $extractPackageRoot = Join-Path $extractRoot "package"

  if (Test-Path $extractRoot) {
    Remove-Item -Path $extractRoot -Recurse -Force
  }

  $url = "https://registry.npmjs.org/code-server/-/code-server-$version.tgz"
  Write-Host "[ensureCodeServer] downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $tempTgz

  Write-Host "[ensureCodeServer] extracting archive"
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  tar -xzf $tempTgz -C $extractRoot

  if (-not (Test-Path $extractPackageRoot)) {
    throw "Extracted package directory not found: $extractPackageRoot"
  }

  if (Test-Path $runtimeRoot) {
    Remove-Item -Path $runtimeRoot -Recurse -Force
  }

  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $extractPackageRoot "*") -Destination $runtimeRoot -Recurse -Force
  Remove-Item -Path $extractRoot -Recurse -Force
  Remove-Item -Path $tempTgz -Force

  if (-not (Test-Path $entryPath)) {
    throw "code-server entry not found after extraction: $entryPath"
  }

  Write-Host "[ensureCodeServer] installing runtime dependencies"
  Push-Location $runtimeRoot
  try {
    npm install --omit=dev --ignore-scripts
  } finally {
    Pop-Location
  }
} else {
  Write-Host "[ensureCodeServer] code-server runtime found, verifying all declared dependencies"
}

Install-PackagesIfMissing -RuntimeRoot $runtimeRoot -ManifestPaths $manifestPaths
Rebuild-NativePackagesIfNeeded -RuntimeRoot $runtimeRoot -ManifestPaths $manifestPaths

if (-not (Test-Path $loggerPackage)) {
  throw "code-server dependencies missing after install: $loggerPackage"
}

Write-Host "[ensureCodeServer] ready: $entryPath"

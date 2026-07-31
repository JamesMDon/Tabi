$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $projectRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$distPath = Join-Path $projectRoot 'dist'
$packagePath = Join-Path $distPath "tabi-$($manifest.version).zip"
$stagingPath = Join-Path ([System.IO.Path]::GetTempPath()) ("tabi-package-" + [guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Path $distPath -Force | Out-Null
New-Item -ItemType Directory -Path $stagingPath | Out-Null

try {
  Copy-Item -LiteralPath $manifestPath -Destination $stagingPath
  Copy-Item -LiteralPath (Join-Path $projectRoot 'icons') -Destination $stagingPath -Recurse
  $releaseSourcePath = Join-Path $stagingPath 'src'
  New-Item -ItemType Directory -Path $releaseSourcePath | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot 'src\background.js') -Destination $releaseSourcePath
  Copy-Item -LiteralPath (Join-Path $projectRoot 'src\core.js') -Destination $releaseSourcePath

  if (Test-Path -LiteralPath $packagePath) {
    Remove-Item -LiteralPath $packagePath -Force
  }

  Compress-Archive -Path (Join-Path $stagingPath '*') -DestinationPath $packagePath -CompressionLevel Optimal
} finally {
  $resolvedTempRoot = (Resolve-Path -LiteralPath ([System.IO.Path]::GetTempPath())).Path
  $resolvedStagingPath = (Resolve-Path -LiteralPath $stagingPath).Path
  if (-not $resolvedStagingPath.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove staging path outside the temporary directory: $resolvedStagingPath"
  }
  Remove-Item -LiteralPath $resolvedStagingPath -Recurse -Force
}

$hash = Get-FileHash -LiteralPath $packagePath -Algorithm SHA256
[pscustomobject]@{
  Package = $packagePath
  SHA256 = $hash.Hash
  Version = $manifest.version
} | Format-List

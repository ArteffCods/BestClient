<#
.SYNOPSIS
    Generates every BestClient icon asset from the single source logo.

.DESCRIPTION
    Run this after replacing launcher/resources/logo-source.png. It writes:

      launcher/resources/icon.ico   exe + window/taskbar icon, 7 sizes
      launcher/resources/icon.png   512 px fallback for electron-builder
      launcher/public/logo.png      256 px, shown in the title bar

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#>
[CmdletBinding()]
param(
  [string]$Source,
  [string]$ResourcesDir,
  [string]$PublicDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = Join-Path $root 'launcher\resources\logo-source.png' }
if (-not $ResourcesDir) { $ResourcesDir = Join-Path $root 'launcher\resources' }
if (-not $PublicDir) { $PublicDir = Join-Path $root 'launcher\public' }

if (-not (Test-Path $Source)) { throw "Nincs meg a forras logo: $Source" }

New-Item -ItemType Directory -Force -Path $ResourcesDir, $PublicDir | Out-Null
$src = [System.Drawing.Image]::FromFile($Source)

function Resize-ToPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()

  $ms = New-Object IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return $ms.ToArray()
}

[IO.File]::WriteAllBytes((Join-Path $ResourcesDir 'icon.png'), (Resize-ToPng 512))
[IO.File]::WriteAllBytes((Join-Path $PublicDir 'logo.png'), (Resize-ToPng 256))
Write-Host 'icon.png (512) es logo.png (256) kesz'

# Vista+ ICO entries may hold PNG data directly, which preserves the alpha channel and
# avoids hand-rolling the BMP + AND-mask encoding the old format needs.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @{}
foreach ($s in $sizes) { $images[$s] = Resize-ToPng $s }

$out = New-Object IO.MemoryStream
$w = New-Object IO.BinaryWriter $out

$w.Write([UInt16]0)
$w.Write([UInt16]1)
$w.Write([UInt16]$sizes.Count)

$offset = 6 + (16 * $sizes.Count)

foreach ($s in $sizes) {
  $bytes = $images[$s]
  $dim = if ($s -ge 256) { 0 } else { $s }   # 0 encodes 256
  $w.Write([Byte]$dim)
  $w.Write([Byte]$dim)
  $w.Write([Byte]0)
  $w.Write([Byte]0)
  $w.Write([UInt16]1)
  $w.Write([UInt16]32)
  $w.Write([UInt32]$bytes.Length)
  $w.Write([UInt32]$offset)
  $offset += $bytes.Length
}

$w.Flush()

# Written straight to the stream: BinaryWriter.Write(byte[]) binds to the single-byte
# overload under PowerShell and would emit one byte per image.
foreach ($s in $sizes) {
  $bytes = [byte[]]$images[$s]
  $out.Write($bytes, 0, $bytes.Length)
}

$icoPath = Join-Path $ResourcesDir 'icon.ico'
[IO.File]::WriteAllBytes($icoPath, $out.ToArray())
$w.Dispose()
$src.Dispose()

Write-Host "icon.ico kesz: $([math]::Round((Get-Item $icoPath).Length / 1KB, 1)) kB, felbontasok: $($sizes -join ', ')"

$check = New-Object System.Drawing.Icon($icoPath, 32, 32)
Write-Host "ellenorzes: betoltheto, 32x32 -> $($check.Width)x$($check.Height)"
$check.Dispose()

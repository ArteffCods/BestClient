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

Write-Host "icon.ico kesz: $([math]::Round((Get-Item $icoPath).Length / 1KB, 1)) kB, felbontasok: $($sizes -join ', ')"

$check = New-Object System.Drawing.Icon($icoPath, 32, 32)
Write-Host "ellenorzes: betoltheto, 32x32 -> $($check.Width)x$($check.Height)"
$check.Dispose()

# --- NSIS installer artwork ----------------------------------------------------
# The wizard shows these during install. NSIS wants 24-bit BMP with no alpha, at the
# exact sizes below, so the logo is composited onto the brand-dark background here.

function New-InstallerBmp([int]$w, [int]$h, [string]$path, [bool]$withWordmark) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $h,
    ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # Vertical brand-dark wash so the logo tile does not float on a flat block.
  $top = [System.Drawing.Color]::FromArgb(255, 22, 8, 20)
  $bottom = [System.Drawing.Color]::FromArgb(255, 12, 6, 16)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $top, $bottom, 90
  $g.FillRectangle($brush, $rect)
  $brush.Dispose()

  if ($withWordmark) {
    # Sidebar (welcome/finish): logo centred high, wordmark under it.
    $logo = [int]($w * 0.62)
    $lx = [int](($w - $logo) / 2)
    $ly = [int]($h * 0.16)
    $g.DrawImage($src, $lx, $ly, $logo, $logo)

    $f1 = New-Object System.Drawing.Font 'Bahnschrift SemiBold', 18, ([System.Drawing.FontStyle]::Bold)
    $f2 = New-Object System.Drawing.Font 'Consolas', 8
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 240, 244))
    $rose = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 117, 195))
    $dim = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 150, 140, 150))
    $center = New-Object System.Drawing.StringFormat
    $center.Alignment = [System.Drawing.StringAlignment]::Center

    # Centre the two-tone wordmark as one unit: measure both halves, then lay them out
    # left-to-right from the joint centre so nothing runs off the edge.
    $noPad = [System.Drawing.StringFormat]::GenericTypographic
    $wBest = $g.MeasureString('Best', $f1, 1000, $noPad).Width
    $wClient = $g.MeasureString('Client', $f1, 1000, $noPad).Width
    $startX = ($w - ($wBest + $wClient)) / 2
    $ty = $ly + $logo + 14
    $g.DrawString('Best', $f1, $white, [single]$startX, [single]$ty, $noPad)
    $g.DrawString('Client', $f1, $rose, [single]($startX + $wBest), [single]$ty, $noPad)
    $g.DrawString('bestpvp.eu', $f2, $dim, (New-Object System.Drawing.RectangleF 0, ($h - 26), $w, 20), $center)

    $f1.Dispose(); $f2.Dispose(); $white.Dispose(); $rose.Dispose(); $dim.Dispose(); $center.Dispose()
  } else {
    # Header strip: small logo on the left, wordmark beside it.
    $logo = [int]($h * 0.72)
    $ly = [int](($h - $logo) / 2)
    $g.DrawImage($src, 8, $ly, $logo, $logo)

    $f1 = New-Object System.Drawing.Font 'Bahnschrift SemiBold', 12, ([System.Drawing.FontStyle]::Bold)
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 240, 244))
    $g.DrawString('BestClient', $f1, $white, [single]($logo + 14), [single]($h / 2 - 10))
    $f1.Dispose(); $white.Dispose()
  }

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
}

$sidebar = Join-Path $ResourcesDir 'installer-sidebar.bmp'
$header = Join-Path $ResourcesDir 'installer-header.bmp'
New-InstallerBmp 164 314 $sidebar $true
New-InstallerBmp 150 57 $header $false
Write-Host "telepito kepek kesz: installer-sidebar.bmp (164x314), installer-header.bmp (150x57)"

$src.Dispose()

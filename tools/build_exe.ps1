# Builds GTPlanner.exe (next to index.html) with the C# compiler that ships with Windows. No downloads, no installs.
#   powershell -ExecutionPolicy Bypass -File tools\build_exe.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "csc.exe (the .NET Framework 4 C# compiler) was not found." }

# --- icon: a small flowsheet glyph, written as a PNG-in-ICO file ---
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 48; $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
$path.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90); $path.AddArc(0, $size - $r - 1, $r, $r, 90, 90); $path.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#14161a"))), $path)
$pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#4da3ff")), 14
$g.DrawBezier($pen, 70, 84, 130, 84, 120, 172, 190, 172)
$g.DrawBezier($pen, 70, 172, 130, 172, 120, 84, 190, 84)
$green = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#4cc38a"))
$amber = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#ffb454"))
$g.FillRectangle($green, 28, 56, 56, 46); $g.FillRectangle($green, 28, 150, 56, 46)
$g.FillRectangle($amber, 172, 104, 56, 46)
$g.Dispose()
$ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $png = $ms.ToArray(); $bmp.Dispose()
$ico = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)                       # ICONDIR: reserved, type=icon, count
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)           # 256x256, no palette
$w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
$w.Write($png); $w.Flush()
$icoPath = Join-Path $PSScriptRoot "GTPlanner.ico"
[IO.File]::WriteAllBytes($icoPath, $ico.ToArray())

# --- compile ---
$out = Join-Path $root "GTPlanner.exe"
if (Test-Path $out) { Remove-Item $out -Force }
& $csc /nologo /target:winexe /optimize+ "/out:$out" "/win32icon:$icoPath" /reference:System.Windows.Forms.dll (Join-Path $PSScriptRoot "GTPlanner.cs")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) { throw "Compile failed." }
"Built $out ($([math]::Round((Get-Item $out).Length/1KB)) KB)"

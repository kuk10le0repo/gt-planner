# Builds data/dataset.json (+ data/version.json) from dumps/*.json so the app can load your recipe data in one small file.
# That is the file you publish for friends. Re-run it after you re-export the dumps from the game.
#   powershell -ExecutionPolicy Bypass -File tools\make_dataset.ps1 [-Name "Star Technology"]
param([string]$Name = "Star Technology (KubeJS export)")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $root "dumps\gt_planner_dump.json"))) { throw "dumps\gt_planner_dump.json is missing: export it from the game first (see README)." }

$edge = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
          "C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") | ? { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw "Edge or Chrome is needed to run the converter headlessly." }

# a local server for the page: reuse GTPlanner.exe if it is already running, otherwise start it just for this
$port = 8099; $started = $null
$ours = $false
try { $ours = ((Invoke-WebRequest "http://127.0.0.1:$port/__gtplanner" -UseBasicParsing -TimeoutSec 2).Content -eq "GTPlanner") } catch {}
if (-not $ours) {
  $exe = Join-Path $root "GTPlanner.exe"
  if (-not (Test-Path $exe)) { throw "GTPlanner.exe not found: run tools\build_exe.ps1 first." }
  $started = Start-Process $exe -ArgumentList "--no-browser" -PassThru; Start-Sleep 2
}

$tmp = Join-Path $env:TEMP ("gtp_ds_" + [guid]::NewGuid().ToString("N")); New-Item -ItemType Directory $tmp | Out-Null
$outFile = Join-Path $tmp "dom.html"
$version = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
$url = "http://127.0.0.1:$port/tools/make_dataset.html?v=$version&name=" + [uri]::EscapeDataString($Name)
try {
  Start-Process $edge -ArgumentList @("--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=`"$tmp\profile`"", "--virtual-time-budget=180000", "--dump-dom", $url) `
    -RedirectStandardOutput $outFile -Wait -NoNewWindow
  $html = [IO.File]::ReadAllText($outFile)
  $title = [regex]::Match($html, '<title>([^<]*)</title>').Groups[1].Value
  if ($title -notlike "done:*") { $msg = [regex]::Match($html, '<pre id="out">([\s\S]{0,300})').Groups[1].Value; throw "Conversion did not finish (title '$title'). $msg" }
  $m = [regex]::Match($html, '<pre id="out">([\s\S]*?)</pre>')
  $json = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
  if (-not $json.StartsWith("{")) { throw "Unexpected output from the converter." }
  $dataDir = Join-Path $root "data"; New-Item -ItemType Directory -Force $dataDir | Out-Null
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $dataDir "dataset.json"), $json, $utf8)
  $parts = $title.Split(":")
  [IO.File]::WriteAllText((Join-Path $dataDir "version.json"), ('{"version":"' + $version + '","recipes":' + $parts[1] + ',"multiblocks":' + $parts[2] + '}'), $utf8)
  "Wrote data\dataset.json ($([math]::Round((Get-Item (Join-Path $dataDir 'dataset.json')).Length/1MB,1)) MB): $($parts[1]) recipes, $($parts[2]) multiblocks, version $version"
} finally {
  if ($started -and -not $started.HasExited) { Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

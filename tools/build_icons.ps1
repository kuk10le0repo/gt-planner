# Builds gt-planner/icons from your modpack's jars (run once, or after changing the modpack).
#   powershell -ExecutionPolicy Bypass -File tools\build_icons.ps1
# Reads:  <instance>\mods\*.jar, the Minecraft client jar, <instance>\kubejs\assets,
#         dumps\gt_planner_dump.json (which items are used), dumps\gt_planner_materials.json (colours)
# Writes: icons\tex\... (PNG textures) and icons\index.js
param(
  [string]$Instance = "$env:APPDATA\PrismLauncher\instances\Star Technology\minecraft",
  [string]$ClientJar = "$env:APPDATA\PrismLauncher\libraries\com\mojang\minecraft\1.20.1\minecraft-1.20.1-client.jar"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path $PSScriptRoot -Parent
$iconDir = Join-Path $root "icons"
$sw = [Diagnostics.Stopwatch]::StartNew()

# ---- 1. index every source ------------------------------------------------
$zips = New-Object System.Collections.ArrayList
$index = @{}      # "assets/ns/..." -> @{ z = zip index } or @{ f = file path }
$keep = '^assets/[^/]+/(models/(item|block)/.+\.json|textures/.+\.png)$'
$jars = @()
if (Test-Path $ClientJar) { $jars += Get-Item $ClientJar }
$jars += Get-ChildItem (Join-Path $Instance "mods") -Filter *.jar
foreach ($j in $jars) {
  try { $z = [IO.Compression.ZipFile]::OpenRead($j.FullName) } catch { continue }
  $zi = $zips.Add($z)
  foreach ($e in $z.Entries) { if ($e.FullName -match $keep -and -not $index.ContainsKey($e.FullName)) { $index[$e.FullName] = @{ z = $zi; e = $e } } }
}
$kjs = Join-Path $Instance "kubejs\assets"
if (Test-Path $kjs) {
  Get-ChildItem $kjs -Recurse -File | ForEach-Object {
    $rel = "assets/" + $_.FullName.Substring($kjs.Length + 1).Replace("\", "/")
    if ($rel -match $keep) { $index[$rel] = @{ f = $_.FullName } }     # kubejs overrides jars
  }
}
"indexed $($index.Count) files from $($jars.Count) jars in $([int]$sw.Elapsed.TotalSeconds)s"

function Read-Json([string]$path) {
  $it = $index[$path]; if (-not $it) { return $null }
  if ($it.f) { $s = [IO.File]::ReadAllText($it.f) }
  else { $r = New-Object IO.StreamReader($it.e.Open()); $s = $r.ReadToEnd(); $r.Close() }
  try { return $s | ConvertFrom-Json } catch { return $null }
}
function Split-Ref([string]$ref, [string]$kind) {   # "ns:path" or "path" -> ns, path
  if ($ref -match '^([a-z0-9_.-]+):(.+)$') { return @($Matches[1], $Matches[2]) }
  return @("minecraft", $ref)
}
function Resolve-Textures([string]$modelRef) {       # follow parents, child wins
  $tex = @{}; $ref = $modelRef
  for ($d = 0; $d -lt 10 -and $ref; $d++) {
    $ns, $p = Split-Ref $ref
    $m = Read-Json "assets/$ns/models/$p.json"
    if (-not $m) { break }
    if ($m.textures) { foreach ($pr in $m.textures.PSObject.Properties) { if (-not $tex.ContainsKey($pr.Name)) { $tex[$pr.Name] = [string]$pr.Value } } }
    $ref = $m.parent
  }
  # resolve "#name" references
  foreach ($k in @($tex.Keys)) { $v = $tex[$k]; $n = 0; while ($v -like '#*' -and $n -lt 6) { $v = $tex[$v.Substring(1)]; $n++ }; $tex[$k] = $v }
  return $tex
}
$copied = @{}
function Copy-Texture([string]$ref) {                # returns icons-relative path or $null
  if (-not $ref -or $ref -like '#*') { return $null }
  $ns, $p = Split-Ref $ref
  $src = "assets/$ns/textures/$p.png"
  $it = $index[$src]; if (-not $it) { return $null }
  $rel = "tex/$ns/$p.png"
  if (-not $copied.ContainsKey($rel)) {
    $dest = Join-Path $iconDir $rel
    New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
    if ($it.f) { Copy-Item $it.f $dest -Force } else { [IO.Compression.ZipFileExtensions]::ExtractToFile($it.e, $dest, $true) }
    $copied[$rel] = 1
  }
  return $rel
}

# ---- 2. material icon sets ------------------------------------------------
$ms = [ordered]@{}
foreach ($k in $index.Keys) {
  if ($k -match '^assets/gtceu/models/item/material_sets/([^/]+)/([^/]+)\.json$') {
    $set = $Matches[1]; $name = $Matches[2]
    $t = Resolve-Textures "gtceu:item/material_sets/$set/$name"
    $l = @(); foreach ($n in 'layer0', 'layer1', 'layer2') { $l += (Copy-Texture $t[$n]) }
    if ($l[0] -or $l[1] -or $l[2]) {
      if (-not $ms.Contains($set)) { $ms[$set] = [ordered]@{} }
      $ms[$set][$name] = $l
    }
  }
}
# material blocks and frames live under textures/block/material_sets/<set>/
$blk = @{}
foreach ($k in $index.Keys) {
  if ($k -match '^assets/gtceu/textures/block/material_sets/([^/]+)/(block|block_secondary|frame_gt|frame_gt_secondary)\.png$') {
    if (-not $blk.ContainsKey($Matches[1])) { $blk[$Matches[1]] = @{} }
    $blk[$Matches[1]][$Matches[2]] = Copy-Texture "gtceu:block/material_sets/$($Matches[1])/$($Matches[2])"
  }
}
foreach ($set in $blk.Keys) {
  if (-not $ms.Contains($set)) { $ms[$set] = [ordered]@{} }
  if ($blk[$set]['block']) { $ms[$set]['block'] = @($blk[$set]['block'], $blk[$set]['block_secondary'], $null) }
  if ($blk[$set]['frame_gt']) { $ms[$set]['frame'] = @($blk[$set]['frame_gt'], $blk[$set]['frame_gt_secondary'], $null) }
}
"material sets: $($ms.Count), templates: $(($ms.Values | % { $_.Count } | Measure-Object -Sum).Sum)"

# ---- 3. materials (colours) ----------------------------------------------
$materials = [ordered]@{}
$mf = Join-Path $root "dumps\gt_planner_materials.json"
if (Test-Path $mf) {
  $mj = Get-Content $mf -Raw | ConvertFrom-Json
  foreach ($m in $mj.materials) { $materials[$m.name] = @([int]$m.color, [int]$m.secondary, [string]$m.iconSet) }
  "materials: $($materials.Count)"
} else { "WARNING: dumps\gt_planner_materials.json not found - material items will not be tinted yet" }

# Machines/hatches use a code-driven model: item -> block model with "variants" -> casing + overlay textures.
# Flatten the first variant to a few stacked 2D layers (casing side, front overlay, emissive overlay).
function Resolve-MachineLayers([string]$ns, [string]$name) {
  $im = Read-Json "assets/$ns/models/item/$name.json"
  if (-not $im -or -not $im.parent) { return $null }
  $pns, $pp = Split-Ref $im.parent
  $bm = Read-Json "assets/$pns/models/$pp.json"
  if (-not $bm -or -not $bm.variants) { return $null }
  $first = ($bm.variants.PSObject.Properties | Select-Object -First 1).Value
  $model = $first.model; if ($model -is [array]) { $model = $model[0] }
  if (-not $model) { return $null }
  $tex = @{}
  if ($model.textures) { foreach ($pr in $model.textures.PSObject.Properties) { $tex[$pr.Name] = [string]$pr.Value } }
  if ($model.parent) { $pt = Resolve-Textures $model.parent; foreach ($k in $pt.Keys) { if (-not $tex.ContainsKey($k)) { $tex[$k] = $pt[$k] } } }
  foreach ($k in @($tex.Keys)) { $v = $tex[$k]; $n = 0; while ($v -like '#*' -and $n -lt 6) { $v = $tex[$v.Substring(1)]; $n++ }; $tex[$k] = $v }
  $layers = @()
  foreach ($k in 'side', 'all', 'front', 'top') { if ($tex[$k]) { $r = Copy-Texture $tex[$k]; if ($r) { $layers += $r; break } } }
  foreach ($grp in @(@('overlay_front', 'overlay'), @('overlay_front_emissive', 'overlay_emissive'))) {
    foreach ($k in $grp) { if ($tex[$k]) { $r = Copy-Texture $tex[$k]; if ($r) { $layers += $r; break } } }
  }
  if ($layers.Count -eq 0) { return $null }
  return ,$layers
}

# ---- 4. real items (models exist) ----------------------------------------
$direct = [ordered]@{}
$ids = [Text.RegularExpressions.Regex]::Matches([IO.File]::ReadAllText((Join-Path $root "dumps\gt_planner_dump.json")), '"(?:item|fluid)"\s*:\s*"([a-z0-9_.\-]+:[a-z0-9_./\-]+)"') | % { $_.Groups[1].Value } | Sort-Object -Unique
$pref = 'layer0', 'all', 'front', 'side', 'top', 'particle', 'north', 'texture'
$machines = 0
foreach ($id in $ids) {
  $ns, $name = $id.Split(':', 2)
  if (-not $index.ContainsKey("assets/$ns/models/item/$name.json")) { continue }
  $t = Resolve-Textures "$ns`:item/$name"
  $ref = $null
  foreach ($k in $pref) { if ($t.ContainsKey($k) -and $t[$k]) { $ref = $t[$k]; break } }
  if (-not $ref -and $t.Count) { $ref = ($t.Values | ? { $_ -and $_ -notlike '#*' } | Select-Object -First 1) }
  $rel = Copy-Texture $ref
  if ($rel) { $direct[$id] = $rel }
  else { $lay = Resolve-MachineLayers $ns $name; if ($lay) { $direct[$id] = $lay; $machines++ } }
}
"direct icons: $($direct.Count) of $($ids.Count) ids ($machines flattened machine icons)"

# programmed circuits are not ordinary item ids in the dump (they carry a number): one icon per setting
$circuits = 0
foreach ($n in 0..32) {
  # follow each setting's model (the texture number does not always match the setting, e.g. setting 0)
  $t = Resolve-Textures "gtceu:item/programmed_circuit/$n"
  $layers = @(); foreach ($k in 'layer0', 'layer1', 'layer2') { if ($t[$k]) { $r = Copy-Texture $t[$k]; if ($r) { $layers += $r } } }
  if ($layers.Count) { $direct["gtceu:programmed_circuit_$n"] = $layers; $circuits++ }
}
"programmed circuit icons: $circuits"

# ---- 5. write the index ---------------------------------------------------
$obj = [ordered]@{ materials = $materials; ms = $ms; direct = $direct }
$json = $obj | ConvertTo-Json -Depth 6 -Compress
New-Item -ItemType Directory -Force $iconDir | Out-Null
[IO.File]::WriteAllText((Join-Path $iconDir "index.js"), "window.ICON_INDEX = $json;", (New-Object Text.UTF8Encoding($false)))
foreach ($z in $zips) { $z.Dispose() }

# ---- 6. pack every texture into ONE file (icons/textures.js) so the app can be hosted anywhere (e.g. GitHub Pages)
#         with a single request instead of ~2000, and so images never taint the canvas (PNG export keeps its icons)
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append("window.ICON_TEX={")
$first = $true
foreach ($rel in ($copied.Keys | Sort-Object)) {
  $bytes = [IO.File]::ReadAllBytes((Join-Path $iconDir $rel))
  if (-not $first) { [void]$sb.Append(",") }; $first = $false
  [void]$sb.Append('"' + $rel + '":"data:image/png;base64,' + [Convert]::ToBase64String($bytes) + '"')
}
[void]$sb.Append("};")
[IO.File]::WriteAllText((Join-Path $iconDir "textures.js"), $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
"done in $([int]$sw.Elapsed.TotalSeconds)s -> $iconDir ($($copied.Count) textures; textures.js $([math]::Round((Get-Item (Join-Path $iconDir 'textures.js')).Length/1MB,1)) MB)"

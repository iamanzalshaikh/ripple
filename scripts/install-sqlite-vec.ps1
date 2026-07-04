# Optional sqlite-vec speedup for P8 semantic search.
# Without vec0.dll, Ripple uses JS cosine similarity (works fine for dev).

$ErrorActionPreference = "Stop"
$nativeDir = Join-Path $env:LOCALAPPDATA "Ripple\native"
New-Item -ItemType Directory -Force -Path $nativeDir | Out-Null

$dest = Join-Path $nativeDir "vec0.dll"
if (Test-Path $dest) {
  Write-Host "vec0.dll already present at $dest"
  exit 0
}

Write-Host @"
sqlite-vec DLL is not bundled in this repo.

To enable faster vector search:
1. Download vec0.dll for Windows x64 from https://github.com/asg017/sqlite-vec/releases
2. Copy to: $dest
3. Restart Ripple (npm run dev)

Or set RIPPLE_SQLITE_VEC_PATH to your DLL path before starting Ripple.
"@

exit 1

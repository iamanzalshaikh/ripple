# Install Rust + MSVC linker (Windows) — run once before `npm run native:build`

$ErrorActionPreference = "Stop"

Write-Host "=== Ripple P7 — Rust toolchain ==="

if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
  Write-Host "Installing rustup..."
  winget install Rustlang.Rustup --accept-package-agreements --accept-source-agreements
} else {
  Write-Host "rustup already installed"
}

rustup default stable

if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
  Write-Host @"

MSVC linker (link.exe) not found.
Install Visual Studio 2022 Build Tools with "Desktop development with C++":

  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Then open a NEW terminal and run:

  cd ripple-desktop
  npm run native:build
  npm run dev

"@
  exit 1
}

Write-Host "Building ripple-native..."
Set-Location $PSScriptRoot\..
npm run native:build
Write-Host "Done. Start Ripple with: npm run dev"

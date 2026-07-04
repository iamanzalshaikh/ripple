# Code-sign ripple-native.exe for Windows SmartScreen (requires a code signing certificate).
param(
  [string]$ExePath = "",
  [string]$CertThumbprint = $env:RIPPLE_SIGN_CERT_THUMBPRINT
)

$ErrorActionPreference = "Stop"

if (-not $ExePath) {
  $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $ExePath = Join-Path $root "resources\native\win32\ripple-native.exe"
}

if (-not (Test-Path $ExePath)) {
  throw "Binary not found: $ExePath"
}

if (-not $CertThumbprint) {
  Write-Host "Set RIPPLE_SIGN_CERT_THUMBPRINT or pass -CertThumbprint."
  Write-Host "Available code signing certs:"
  Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My | Where-Object { $_.HasPrivateKey } | Format-Table Thumbprint, Subject -AutoSize
  exit 1
}

$cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My | Where-Object { $_.Thumbprint -eq $CertThumbprint } | Select-Object -First 1
if (-not $cert) {
  throw "Certificate not found for thumbprint: $CertThumbprint"
}

Set-AuthenticodeSignature -FilePath $ExePath -Certificate $cert -TimestampServer "http://timestamp.digicert.com" | Format-List
Write-Host "Signed: $ExePath"

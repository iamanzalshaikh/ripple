# Run once after loading the Ripple extension in Chrome and/or Edge.
param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId,
  [string]$EdgeExtensionId = ""
)

$ErrorActionPreference = "Stop"
$hostDir = $PSScriptRoot
$cmdPath = Join-Path $hostDir "native-host.cmd"
$manifestPath = Join-Path $hostDir "com.ripple.whatsapp.json"
$chromeRegistryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ripple.whatsapp"
$edgeRegistryKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.ripple.whatsapp"

$json = Get-Content $manifestPath -Raw
$json = $json.Replace("NATIVE_HOST_CMD_PATH", ($cmdPath -replace '\\', '/'))

$origins = @("chrome-extension://$ExtensionId/")
if ($EdgeExtensionId) {
  $origins += "chrome-extension://$EdgeExtensionId/"
}
$originsJson = ($origins | ForEach-Object { "`"$_`"" }) -join ","
$json = $json -replace '"allowed_origins"\s*:\s*\[[^\]]*\]', "`"allowed_origins`": [$originsJson]"

$installedManifest = Join-Path $hostDir "com.ripple.whatsapp.installed.json"
Set-Content -Path $installedManifest -Value $json -Encoding UTF8

New-Item -Path $chromeRegistryKey -Force | Out-Null
Set-ItemProperty -Path $chromeRegistryKey -Name "(default)" -Value $installedManifest

Write-Host "Installed Native Messaging host for Chrome extension $ExtensionId"
Write-Host "Chrome registry: $chromeRegistryKey"

if ($EdgeExtensionId) {
  New-Item -Path $edgeRegistryKey -Force | Out-Null
  Set-ItemProperty -Path $edgeRegistryKey -Name "(default)" -Value $installedManifest
  Write-Host "Installed Native Messaging host for Edge extension $EdgeExtensionId"
  Write-Host "Edge registry: $edgeRegistryKey"
} else {
  Write-Host "Tip: pass -EdgeExtensionId <id from edge://extensions> for WhatsApp in Edge"
}

Write-Host "Manifest: $installedManifest"

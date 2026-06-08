# Run once after loading the Ripple extension in Chrome (need Extension ID from chrome://extensions)
param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"
$hostDir = $PSScriptRoot
$cmdPath = Join-Path $hostDir "native-host.cmd"
$manifestPath = Join-Path $hostDir "com.ripple.whatsapp.json"
$registryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ripple.whatsapp"

$json = Get-Content $manifestPath -Raw
$json = $json.Replace("NATIVE_HOST_CMD_PATH", ($cmdPath -replace '\\', '/'))
$json = $json.Replace("EXTENSION_ID_PLACEHOLDER", $ExtensionId)
$installedManifest = Join-Path $hostDir "com.ripple.whatsapp.installed.json"
Set-Content -Path $installedManifest -Value $json -Encoding UTF8

New-Item -Path $registryKey -Force | Out-Null
Set-ItemProperty -Path $registryKey -Name "(default)" -Value $installedManifest

Write-Host "Installed Native Messaging host for extension $ExtensionId"
Write-Host "Registry: $registryKey"
Write-Host "Manifest: $installedManifest"

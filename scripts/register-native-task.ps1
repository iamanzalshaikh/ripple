# Registers ripple-native.exe to start at user logon (Task Scheduler).
# Run from an elevated PowerShell if you want machine-wide install; user scope works without admin.
param(
  [string]$ExePath = "",
  [string]$TaskName = "RippleNativeSidecar"
)

$ErrorActionPreference = "Stop"

if (-not $ExePath) {
  $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $candidates = @(
    (Join-Path $root "resources\native\win32\ripple-native.exe"),
    (Join-Path $root "ripple-native\target\release\ripple-native.exe"),
    (Join-Path $root "ripple-native\target\debug\ripple-native.exe")
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $ExePath = $c; break }
  }
}

if (-not (Test-Path $ExePath)) {
  throw "ripple-native.exe not found. Build with: npm run native:build"
}

$action = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory (Split-Path $ExePath)
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered scheduled task '$TaskName' -> $ExePath"

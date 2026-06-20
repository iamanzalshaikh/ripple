# Generates WAV fixtures for live Whisper E2E (Windows SAPI).
param(
  [string]$OutDir = "$PSScriptRoot\..\electron\automation\voice\nlu\__tests__\fixtures\whisper"
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

$phrases = @{
  "download-kholo.wav"  = "Download kholo"
  "open-downloads.wav"  = "Open downloads"
  "mera-resume.wav"     = "Mera resume kholo"
  "open-calculator.wav" = "Open calculator"
  "open-it-again.wav"   = "Open it again"
  "open-whatsapp.wav"   = "Open WhatsApp"
  "message-noor.wav"    = "Message Noor hello"
  "open-youtube.wav"    = "Open YouTube"
}

foreach ($entry in $phrases.GetEnumerator()) {
  $path = Join-Path $OutDir $entry.Key
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($entry.Value)
  $synth.SetOutputToNull()
  Write-Host "Wrote $path"
}

Write-Host "Done - $($phrases.Count) fixtures in $OutDir"

# Installs yt-dlp, ffmpeg and Deno for MultiMessenger on Windows (no admin rights needed).
# Run in PowerShell:   powershell -ExecutionPolicy Bypass -File scripts\install-tools.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Join-Path $env:APPDATA 'multi-messenger\tools'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$tmp = Join-Path $env:TEMP ('mm-tools-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host '1/3 yt-dlp ...'
Invoke-WebRequest 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile (Join-Path $dir 'yt-dlp.exe')

Write-Host '2/3 Deno ...'
Invoke-WebRequest 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' -OutFile "$tmp\deno.zip"
Expand-Archive "$tmp\deno.zip" -DestinationPath "$tmp\deno" -Force
Copy-Item "$tmp\deno\deno.exe" (Join-Path $dir 'deno.exe') -Force

Write-Host '3/3 ffmpeg ...'
Invoke-WebRequest 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' -OutFile "$tmp\ffmpeg.zip"
Expand-Archive "$tmp\ffmpeg.zip" -DestinationPath "$tmp\ffmpeg" -Force
$ff = Get-ChildItem "$tmp\ffmpeg" -Recurse -Filter ffmpeg.exe | Select-Object -First 1
Copy-Item $ff.FullName (Join-Path $dir 'ffmpeg.exe') -Force

Remove-Item $tmp -Recurse -Force
Write-Host "Done. Files are in $dir"
Write-Host 'Restart MultiMessenger. It finds them automatically.'

<#
  Heat Guardian host bridge — the watcher that runs ON the meet computer.

  Hy-Tek Meet Manager writes each event's "Real-Time Results to the Web" HTML into a local
  folder (default c:\realtime) every time the operator presses F12. This script watches that
  folder and pushes each changed file OUTBOUND over HTTPS to the Heat Guardian Worker. Nothing
  listens on the meet PC and nothing polls into it — it only makes outbound calls, exactly like
  Active's own Meet Mobile uploader. Parents read the results from the Worker, never from here.

  One-time per meet, on any internet-connected computer:
    Invoke-RestMethod -Method Post https://<your-worker>/live -Body (@{title='2026 Richard Quick'}|ConvertTo-Json) -ContentType application/json
  That returns { code, token }. Hand the CODE to parents (they enter it in the app); keep the TOKEN.

  Then on the meet PC:
    powershell -ExecutionPolicy Bypass -File realtime-bridge.ps1 -Base https://<your-worker> -Code ABC234 -Token <token>

  Stop with Ctrl+C.
#>
param(
  [Parameter(Mandatory = $true)][string]$Base,   # Worker origin, e.g. https://hg.example.workers.dev
  [Parameter(Mandatory = $true)][string]$Code,   # live meet code from POST /live
  [Parameter(Mandatory = $true)][string]$Token,  # write token from POST /live
  [string]$Folder = "C:\realtime",               # MM's Real-Time Results output folder
  [int]$IntervalSec = 5                           # how often to scan for changes
)

$ErrorActionPreference = "Stop"
$endpoint = "$($Base.TrimEnd('/'))/live/$Code"
Write-Host "Heat Guardian bridge — watching $Folder"
Write-Host "Pushing to $endpoint  (Ctrl+C to stop)"
if (-not (Test-Path $Folder)) {
  Write-Warning "$Folder does not exist yet. Enable Real-Time Results in MM (it creates c:\realtime), then leave this running."
}

$seen = @{}  # file path -> last LastWriteTime we successfully pushed

function Push-File($file) {
  try {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $uri = "$endpoint`?name=$([uri]::EscapeDataString($file.Name))"
    Invoke-RestMethod -Method Post -Uri $uri -Body $bytes -ContentType "text/html" `
      -Headers @{ "X-HG-Live-Token" = $Token } -TimeoutSec 20 | Out-Null
    $seen[$file.FullName] = $file.LastWriteTimeUtc
    Write-Host ("{0}  pushed {1}" -f (Get-Date -Format "HH:mm:ss"), $file.Name)
  } catch {
    Write-Warning ("push failed for {0}: {1}" -f $file.Name, $_.Exception.Message)
  }
}

while ($true) {
  if (Test-Path $Folder) {
    $files = Get-ChildItem -Path $Folder -File -Include *.htm, *.html -ErrorAction SilentlyContinue
    foreach ($f in $files) {
      $prev = $seen[$f.FullName]
      if ($null -eq $prev -or $f.LastWriteTimeUtc -gt $prev) { Push-File $f }
    }
  }
  Start-Sleep -Seconds $IntervalSec
}

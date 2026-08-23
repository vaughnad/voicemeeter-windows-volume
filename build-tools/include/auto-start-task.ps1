$ErrorActionPreference = "Stop"

$dir = $PSScriptRoot
$vmwvPath = Join-Path $dir "required\VMWV.exe"

if (-not (Test-Path -LiteralPath $vmwvPath)) {
    throw "Unable to find VMWV executable at '$vmwvPath'."
}

$vmwvPath = (Resolve-Path -LiteralPath $vmwvPath).Path
$vmwv = Get-Process -Name "VMWV" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $vmwvPath } |
    Select-Object -First 1

if ($vmwv) {
    exit 0
}

$vmwv = Start-Process -FilePath $vmwvPath -WorkingDirectory $dir -WindowStyle Hidden -PassThru
$startupDeadline = (Get-Date).AddSeconds(30)

do {
    $vmwv.Refresh()
    if ($vmwv.HasExited) {
        throw "VMWV exited during startup with code $($vmwv.ExitCode)."
    }

    $trayProcess = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($vmwv.Id)" |
        Where-Object { $_.Name -eq "tray_windows_release.exe" } |
        Select-Object -First 1

    if ($trayProcess) {
        exit 0
    }

    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $startupDeadline)

throw "VMWV did not start its tray process within 30 seconds."

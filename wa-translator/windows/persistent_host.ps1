param(
    [ValidateSet('Install', 'Open', 'Status', 'Uninstall')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'
$publicUrl = 'https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/'
$legacyTaskName = 'Live Translator Host'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Live Translator.lnk'
$stateDir = Join-Path $env:LOCALAPPDATA 'LiveTranslator'
$customIcon = Join-Path $stateDir 'LiveTranslator.ico'
$legacyShortcutPaths = @(
    (Join-Path $desktop 'Live Translator - Open.lnk'),
    (Join-Path $desktop 'Live Translator - Start.lnk'),
    (Join-Path $desktop 'Live Translator - Stop.lnk')
)

function Find-Edge {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'Microsoft Edge was not found. Install Edge, then run this installer again.'
}

function Remove-LegacyLocalHost {
    $task = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
    if ($task) {
        $processes = @(Get-CimInstance Win32_Process)
        $legacyProcessIds = @($processes | Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($PSCommandPath,
                [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $_.CommandLine -match '-Action\s+Run'
        } | Select-Object -ExpandProperty ProcessId)
        do {
            $children = @($processes | Where-Object {
                $_.ParentProcessId -in $legacyProcessIds -and
                $_.ProcessId -notin $legacyProcessIds
            } | Select-Object -ExpandProperty ProcessId)
            $legacyProcessIds += $children
        } while ($children.Count -gt 0)

        Stop-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
        foreach ($processId in ($legacyProcessIds | Sort-Object -Descending)) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
    foreach ($path in $legacyShortcutPaths) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}

function Install-DesktopApp {
    $edgeApp = Find-Edge
    Remove-LegacyLocalHost
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $edgeApp
    $shortcut.Arguments = "--app=$publicUrl"
    $shortcut.WorkingDirectory = Split-Path -Parent $edgeApp
    $shortcut.Description = 'Live Translator'
    $shortcut.IconLocation = if (Test-Path -LiteralPath $customIcon) {
        "$customIcon,0"
    } else {
        "$edgeApp,0"
    }
    $shortcut.Save()
    return $shortcutPath
}

switch ($Action) {
    'Install' {
        $installed = Install-DesktopApp
        Write-Host "Installed: $installed"
        Write-Host "Opens: $publicUrl"
    }
    'Open' {
        $installed = Install-DesktopApp
        Start-Process -FilePath $installed
    }
    'Status' {
        $edgeApp = Find-Edge
        $legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
        $health = try {
            Invoke-RestMethod -Uri ($publicUrl + 'health') -Headers @{
                'User-Agent' = 'Mozilla/5.0 LiveTranslatorDesktop'
            } -TimeoutSec 10
        } catch {
            $null
        }
        [pscustomobject]@{
            Installed = Test-Path -LiteralPath $shortcutPath
            Shortcut = $shortcutPath
            Target = $edgeApp
            Arguments = "--app=$publicUrl"
            PublicHealth = $health
            LegacyLocalTask = if ($legacyTask) { [string]$legacyTask.State } else { 'Absent' }
        } | Format-List
    }
    'Uninstall' {
        Remove-LegacyLocalHost
        Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
        Write-Host "Removed: $shortcutPath"
    }
}

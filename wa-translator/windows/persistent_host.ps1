param(
    [ValidateSet('Install', 'Run', 'Start', 'Stop', 'Status', 'Open', 'Uninstall')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'
$taskName = 'Live Translator Host'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$python = Join-Path $repoRoot '.venv\Scripts\python.exe'
$runner = Join-Path $PSScriptRoot 'run_room.py'
$stateDir = Join-Path $env:LOCALAPPDATA 'LiveTranslator'
$log = Join-Path $stateDir 'host.log'
$localUrl = 'http://127.0.0.1:8791/'

function Wait-ForHost {
    $deadline = (Get-Date).AddMinutes(3)
    do {
        try {
            $health = Invoke-RestMethod -Uri ($localUrl + 'health') -TimeoutSec 2
            if ($health.models_ready -and $health.tts.en -eq 'ready' -and
                    $health.tts.es -eq 'ready') {
                return $health
            }
        } catch {
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Translator did not become ready. Check $log"
}

function New-DesktopShortcut([string]$name, [string]$arguments) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut(
        (Join-Path $desktop ($name + '.lnk')))
    $shortcut.TargetPath = 'powershell.exe'
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" $arguments"
    $shortcut.WorkingDirectory = $repoRoot
    $shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,67"
    $shortcut.Save()
}

switch ($Action) {
    'Run' {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        while ($true) {
            "`n[$(Get-Date -Format o)] starting" | Out-File -LiteralPath $log -Append -Encoding utf8
            & $python -u $runner --local 2>&1 | Out-File -LiteralPath $log -Append -Encoding utf8
            "[$(Get-Date -Format o)] stopped; restarting in 5 seconds" |
                Out-File -LiteralPath $log -Append -Encoding utf8
            Start-Sleep -Seconds 5
        }
    }
    'Install' {
        if (-not (Test-Path -LiteralPath $python)) { throw "Missing project Python: $python" }
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
            "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action Run")
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 `
            -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
            -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger `
            -Settings $settings -Principal $principal -Description (
            'Starts the local English-Spanish translated video room at Windows sign-in.') -Force | Out-Null
        New-DesktopShortcut 'Live Translator - Open' '-Action Open'
        New-DesktopShortcut 'Live Translator - Start' '-Action Start'
        New-DesktopShortcut 'Live Translator - Stop' '-Action Stop'
        Start-ScheduledTask -TaskName $taskName
        $health = Wait-ForHost
        Write-Host "Installed and ready: $localUrl"
        $health | ConvertTo-Json -Compress
    }
    'Start' {
        Start-ScheduledTask -TaskName $taskName
        $health = Wait-ForHost
        Write-Host "Ready: $localUrl"
        $health | ConvertTo-Json -Compress
    }
    'Stop' {
        Stop-ScheduledTask -TaskName $taskName
        Write-Host 'Live Translator stopped.'
    }
    'Status' {
        $task = Get-ScheduledTask -TaskName $taskName
        $info = Get-ScheduledTaskInfo -TaskName $taskName
        $health = try { Invoke-RestMethod -Uri ($localUrl + 'health') -TimeoutSec 2 } catch { $null }
        [pscustomobject]@{
            TaskState = $task.State
            LastRun = $info.LastRunTime
            LastResult = $info.LastTaskResult
            LocalUrl = $localUrl
            Health = $health
            Log = $log
        } | Format-List
    }
    'Open' {
        Start-ScheduledTask -TaskName $taskName
        Wait-ForHost | Out-Null
        Start-Process $localUrl
    }
    'Uninstall' {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "Removed $taskName. Logs remain at $log"
    }
}

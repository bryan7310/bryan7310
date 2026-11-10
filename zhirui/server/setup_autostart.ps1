# 建立「志瑞平台伺服器」開機自動啟動排程工作（需系統管理員權限）
$ErrorActionPreference = 'Stop'
$taskName = '志瑞平台伺服器'
$python   = 'C:\Users\ㄧ\AppData\Local\Python\pythoncore-3.15-64\python.exe'
$workDir  = 'C:\zhirui'
try {
    if (-not (Test-Path $python)) { throw "找不到 Python：$python" }
    Write-Host '排程工作會以 Windows 系統帳號 (SYSTEM) 執行，不需要密碼。'

    $action   = New-ScheduledTaskAction -Execute $python -Argument 'server\run_forever.py --port 8080 --data data' -WorkingDirectory $workDir
    $trigger  = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Write-Host ''
    Write-Host "已建立排程工作「$taskName」，之後電腦開機就會自動啟動伺服器。" -ForegroundColor Green

    $busy = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
        Write-Host '目前已經有伺服器在執行（黑色視窗），這次先不另外啟動，下次開機就會自動執行。'
    } else {
        Start-ScheduledTask -TaskName $taskName
        Write-Host '已經在背景啟動伺服器。'
    }
} catch {
    Write-Host ''
    Write-Host "失敗：$($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host '按 Enter 關閉視窗'
# 重新啟動志瑞平台伺服器（更新程式後用；需系統管理員）
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$task = '志瑞平台伺服器'
try {
    Write-Host '停止伺服器…'
    schtasks /end /tn $task | Out-Null
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*app.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $i = 0
    while ((Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) -and $i -lt 30) { Start-Sleep 1; $i++ }
    Write-Host '啟動伺服器…'
    schtasks /run /tn $task | Out-Null
    $ok = $false; $i = 0
    while (-not $ok -and $i -lt 30) { Start-Sleep 1; $i++; try { $ok = (Invoke-WebRequest -UseBasicParsing http://localhost:8080/ -TimeoutSec 3).StatusCode -eq 200 } catch {} }
    Write-Host ''
    if ($ok) { Write-Host '完成：伺服器已重新啟動。' -ForegroundColor Green } else { Write-Host '伺服器還沒回應，請到「工作排程器」對「志瑞平台伺服器」按右鍵→執行。' -ForegroundColor Yellow }
} catch { Write-Host "失敗：$($_.Exception.Message)" -ForegroundColor Red }
Write-Host ''
Read-Host '按 Enter 關閉視窗'
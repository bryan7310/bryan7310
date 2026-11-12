@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 在 Windows「啟動」資料夾放一個捷徑：以後登入 Windows 就自動執行列印小幫手
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\zhirui_print_helper.lnk'); $s.TargetPath='C:\Users\ㄧ\AppData\Local\Python\pythoncore-3.15-64\pythonw.exe'; $s.Arguments='\"%~dp0server\print_helper.py\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
if errorlevel 1 (
  echo 設定失敗
) else (
  echo 已設定：以後登入 Windows 會自動啟動列印小幫手。
  echo 要取消的話，刪掉「啟動」資料夾裡的 zhirui_print_helper 捷徑。
)
call "%~dp0啟動列印小幫手.bat"
pause

@echo off
chcp 65001 >nul
title 志瑞螺絲作業平台 伺服器
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo 找不到 Python。請先到 https://www.python.org/downloads/windows/ 安裝 Python 3（安裝時勾選 "Add python.exe to PATH"）。
  pause
  exit /b 1
)
echo 伺服器啟動中…關掉這個視窗就會停止服務。
python server\app.py --port 8080 --data data
pause

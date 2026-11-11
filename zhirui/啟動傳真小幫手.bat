@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 志瑞傳真小幫手：在這台電腦的桌面上，把平台排好的傳真自動印到 Brother PC-FAX 送出（背景執行，沒有視窗）
start "" "C:\Users\ㄧ\AppData\Local\Python\pythoncore-3.15-64\pythonw.exe" "%~dp0server\fax_helper.py"
echo 傳真小幫手已在背景啟動。紀錄檔：%LOCALAPPDATA%\zhirui\fax_helper.log
timeout /t 3 >nul

@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 志瑞列印小幫手：在這台電腦的桌面上，把手機版排好的列印工作（中一刀出貨單）印到印表機（背景執行，沒有視窗）
start "" "C:\Users\ㄧ\AppData\Local\Python\pythoncore-3.15-64\pythonw.exe" "%~dp0server\print_helper.py"
echo 列印小幫手已在背景啟動。紀錄檔：%LOCALAPPDATA%\zhirui\print_helper.log
timeout /t 3 >nul

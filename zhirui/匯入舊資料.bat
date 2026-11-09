@echo off
chcp 65001 >nul
title 志瑞螺絲作業平台 匯入舊資料
cd /d "%~dp0"
echo 請把舊版共用資料夾（BeeStation 上有 erp-*.json、receivables.v1.json 的那個資料夾）拖進來，然後按 Enter：
set /p SRC=
if "%SRC%"=="" exit /b
set SRC=%SRC:"=%
echo.
echo 要先清空新平台現有的資料再匯入嗎？第一次匯入、或要重新匯入時選 Y；否則選 N（同 id 的資料會被覆蓋）。
set /p RESET=清空後匯入？(Y/N)：
if /i "%RESET%"=="Y" (
  python server\import_legacy.py --src "%SRC%" --data data --pricing pricing --reset
) else (
  python server\import_legacy.py --src "%SRC%" --data data --pricing pricing
)
echo.
pause

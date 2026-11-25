@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 志瑞崧泉小幫手：在這台電腦的桌面上開一個專用的 Edge 視窗連崧泉企業的鼎新 B2B 平台，
rem 定期抓未回覆的採購單（做成 ERP 的待確認檔）、把銷貨單自動建成崧泉出貨單並抓回出貨標籤。
rem 第一次、或連線過期時，要在跳出來的 Edge 視窗自己登入（驗證碼、公司代號、帳號、密碼）。
start "" "%LOCALAPPDATA%\Python\pythoncore-3.15-64\pythonw.exe" "%~dp0server\b2b_helper.py"
echo 崧泉小幫手已在背景啟動。紀錄檔：%LOCALAPPDATA%\zhirui\b2b_helper.log
echo 設定檔：%~dp0data\b2b_helper.json
timeout /t 3 >nul

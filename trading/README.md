# 美股自動交易（Alpaca 模擬帳戶）

每月調整一次的 **ETF 動能輪動** 策略。預設只連 **模擬帳戶 (paper trading)**，不會動到真錢。

## 策略
| 項目 | 設定 |
|---|---|
| 候選標的 | SPY（美股大盤）、QQQ（科技）、IWM（小型股）、EFA（已開發市場）、EEM（新興市場）、TLT（長債）、GLD（黃金）、VNQ（房地產） |
| 動能 | 過去 126 個交易日（約 6 個月）報酬率 |
| 過濾 | 收盤價須高於 200 日均線，且動能 > 0，避開下跌趨勢 |
| 持有 | 動能最強的 3 檔，各約 33%（單檔上限 40%） |
| 避險 | 沒有標的通過時，資金放 SHY（短天期美債） |
| 調整頻率 | 每月一次 |

參數在 `strategy.py` 的 `StrategyConfig`。

## 安全機制
- 預設 **試算模式**：只列出會下的單，加 `--execute` 才送出。
- 預設連 **模擬帳戶**；真實帳戶需同時設定 `ALPACA_LIVE=1` 並加 `--i-understand-real-money`。
- 有未成交訂單、帳戶被限制、單筆超過總資產 45% 時自動停止。
- 市場沒開盤不送單（除非加 `--force`）。
- 每筆訂單寫入 `trade_log.jsonl`。

## 使用步驟
1. 到 <https://alpaca.markets> 註冊（免費），切到 **Paper Trading**，產生 API Key。
2. 安裝套件：`pip install -r requirements.txt`
3. 設定金鑰（不要 commit 進 git）：
   ```bash
   export ALPACA_API_KEY=你的Key
   export ALPACA_API_SECRET=你的Secret
   ```
4. 回測（約 10 年資料，和買進持有 SPY 比較）：`python3 backtest.py`
5. 試算本月要下的單：`python3 bot.py`
6. 確認沒問題後送單（美股開盤時間，台灣約晚上 9:30／冬令 10:30 之後）：`python3 bot.py --execute`
7. 每月第一個交易日執行一次即可（可用 cron 或 GitHub Actions 排程）。

## 每月自動執行（GitHub Actions）
排程檔：`.github/workflows/monthly-trade.yml`
- 每月 1～7 日美股開盤後執行；遇到週末、休市日自動略過，本月已調整過也會略過，所以每月只交易一次（等於每月第一個交易日）。
- 第一次使用前，到 GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**，新增：
  - `ALPACA_API_KEY`
  - `ALPACA_API_SECRET`
- 手動測試：**Actions → 美股每月再平衡 → Run workflow**，不勾「實際送單」只會試算。
- 交易紀錄在每次執行的 Artifacts（保存 400 天），也可到 Alpaca 後台查看。
- 排程只在 **預設分支** 上生效：這個分支合併到 main 後才會開始自動執行。

## 測試
`python3 -m pytest -q`（用模擬價格，不需網路）

## 注意
- 這是教學與模擬用途，不構成投資建議。過去績效不代表未來報酬。
- 至少先用模擬帳戶跑幾個月，了解回撤與交易成本後再考慮真實資金。
- 免費資料源為 IEX，價格與成交量可能和全市場略有差異。

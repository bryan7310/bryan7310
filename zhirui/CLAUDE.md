# 志瑞螺絲智能ERP — 給 Claude 的工作說明

志瑞螺絲（螺絲買賣、委外加工）自己用的進銷存平台。正式在用，資料是真的。
**一律用繁體中文回覆**；使用者常用手機（Remote Control）操作，不在主機電腦前。

- 正式網址：http://10.0.0.19:8080（內網）、https://zhirui.tailabeaf1.ts.net（外網）；手機版 `/m/`
- 程式：`server/`（Python 標準函式庫，沒有框架）、`web/`（原生 JS 模組，沒有打包）
- 資料：`data/zhirui.db`（SQLite，docs 表存 col/id/JSON；舊系統歷史單據在 hist_bills／hist_lines）

## 使用者講的功能 → 程式在哪

使用者用的是畫面上的名稱。**名稱有好幾種可能時（例如「出貨單」），先確認是哪一個**：電腦版畫面、列印格式，還是 App。附截圖最準。

| 使用者會說 | 電腦版頁面（#網址） | 程式 |
|---|---|---|
| 出貨單、銷貨單、開單、銷貨退回 | 出貨銷貨 `#sales` | `web/js/modules/sales.js`（清單）＋ `_bills.js`（所有單據共用的編輯器、清單、期間鈕、單重欄、嘉里鈕） |
| 出貨單**列印**、中一刀、不含價格、出貨單格式 | 出貨銷貨 › 列印 | `web/js/modules/ship.js`（中一刀 241×140mm、主機直接列印、Excel 匯入明細） |
| App 的出貨單、手機開單、最近的出貨單 | App `#bill` | `web/js/m/bill.js` |
| 進貨單、採購單、進貨退出、匯入進貨單 | 採購進貨 `#purchase` | `purchase.js`、`purchase_import.js` |
| 報價單、詢價單 | 報價詢價 `#quotes` | `quotes.js` |
| 客戶訂單、訂單匯入（豐餘 Excel）、傳真轉訂單 | 客戶訂單 `#custorders` | `custorders.js`、`so_import.js`、`order_in.js`；App `m/so.js` |
| 委託加工、加工單 | 委託加工 `#processing` | `processing.js` |
| 訂貨排程 | `#orders` | `orders.js` |
| 庫存、出入庫、調撥 | 庫存數量 `#stock` | `stock.js`；App `m/stock.js` |
| 應收帳款、收款沖帳、未收、應收月份 | 應收帳款 `#receivables` | `receivables.js`；App `m/ar.js` |
| 應付帳款 | `#payables` | `payables.js` |
| 收款單、付款單、帳戶 | 收款登記 `#money` | `money.js` |
| 支票（收到的客票／開出的支票） | `#checks-in`、`#checks-out` | `checks_in.js`、`checks_out.js` |
| 發票 | 發票作業 `#invoices` | `invoices.js` |
| 報表、應收帳款明細、客戶對帳單、銷售利潤、未知成本明細 | 報表明細 `#reports` | `reports.js`；App 經營報表 `m/report.js` |
| 總覽、首頁數字、留言板／交辦事項 | 總覽 `#home` | `home.js`、`memos.js`；App 首頁 `m/app.js` |
| 門市銷售、門市年度彙總 | `#retail` | `retail.js` |
| 商品、客戶、供應商、倉庫、名稱對應、檢查重複、合併 | 基本資料 `#master` | `master.js` |
| 料號、品名規則、自動料號 | — | `web/js/core/codegen.js` |
| 成本、毛利、加工成本（黑身＋電鍍＋熱處理）、阡阡牌價 | 商品資料的「自動成本」；設定 › 加工成本 | `web/js/core/calc.js`（costOf）、`core/proccost.js` |
| 螺絲查價、牌價 | `#pricing` | `pricing.js`、`core/pricing.js` |
| 單重、規格解析 | — | `core/spec.js` |
| 嘉里託運 | `#kerry` | `kerry.js`（前端）、`server/kerry.py`（代登入送單） |
| 標籤（豐餘標籤、一般標籤） | 標籤列印 `#labels` | `labels.js`；App `m/label.js`（佳博 50×40） |
| 郵寄掛號、地址標籤 | `#mail` | `mail.js` |
| 傳真（發出／收到） | `#faxes`、`#faxin` | `faxes.js`、`faxin.js`；`server/fax_helper.py` |
| 電子信箱 | `#email` | `email.js`、`server/zrmail.py`；App `m/email.js` |
| AI 助理、拍照辨識、AI 費用 | `#assistant`；App 上傳 | `assistant.js`、`m/upload.js`；`server/app.py` |
| 螺絲圖面 | `#drawing` | `drawing.js` |
| 常用網站 | `#links` | `links.js` |
| 設定、備份、外觀、帳號、操作日誌 | 設定備份 `#settings` | `settings.js` |
| 確認寫入頁 | `#apply?f=<名稱>` | `apply.js`（讀 `web/pending/<名稱>.json`） |

共用核心：`core/store.js`（資料同步）、`core/calc.js`（單據種類 TYPES、金額、庫存、成本）、`core/ui.js`、`core/util.js`。選單在 `modules/index.js`。

## 工作規則

- **網頁（web/）改了馬上生效**（使用者按 Ctrl+F5）。所以改完要立刻在測試主機打開相關頁面，確認沒有語法錯誤、模組有載入；改壞了正式系統會整個打不開。
- **伺服器（server/*.py）改了要重新啟動**：請使用者按「設定備份 › 備份 › 重新啟動伺服器」。
- **測試**：在 scratchpad 複製一份資料，用 8090 埠啟動測試主機（`python server/app.py --port 8090 --host 127.0.0.1 --data <複製的資料夾>`），在內建瀏覽器測。**不要登入或操作正式主機**；查正式資料用唯讀：`sqlite3` 開 `file:data/zhirui.db?mode=ro`。
- **寫入正式資料**：只能做成 `web/pending/<名稱>.json`，給使用者 `#apply?f=<名稱>` 的連結，由使用者自己按「確認寫入」。寫入後檢查結果，並刪掉那個 json（裡面有價格，`web/` 是公開的；也不要 commit）。
- **帳號密碼**（嘉里、郵件、AI 金鑰等）一律由使用者自己輸入，不要經手。不要代寄 Email、傳真；寄送功能只用模擬模式測試。
- **不要改系統設定**（資料夾共用權限、印表機紙張格式等）：寫步驟請使用者自己做。
- **推送**：每次改完都推到 GitHub `bryan7310/bryan7310` 的 `claude/sleepy-thompson-pcuxb1` 分支（換行轉 LF；commit 訊息用中文）。
- 刪檔案、花 AI API 費用前先問。

## 業務規則（使用者定的）

- **月份一律 25 日結帳**：上月 26 日～本月 25 日（應收、應付、報表、總覽、App）。銷貨單可指定「應收月份」。發票照統一發票的日曆月。
- **舊系統（Access `D:\BeeStation\backup\Data.Mdb`）匯入**：客戶代號跟平台不同，**一律用公司名稱對應**；金額一樣時日期、單號以新平台為準。新舊系統的銷貨單在應收、報表裡一起算。
- **關鍵字搜尋（全站＋App）**：空白或逗號隔開多個字，**每個字都要有**才列出，不分順序、大小寫、全形半形。前端一律用 `core/util.js` 的 `qTerms`／`matchQ`（`combo` 已內建）；伺服器端（舊單據 `db._hist_query`、信箱 `zrmail.listing*`）同樣規則。例外：`util.js` 的同義詞 SYN（止付＝無頭、鐵皮＝鐵板牙、耐落＝防鬆…）使用者確認要保留。
- **料號／品名規則**：見 `core/codegen.js`。新商品用標準品名＋自動料號（stdGoods）。
- **加工品成本**：成品沒有進貨單時，用黑身／白皮（料號第 3 碼 D）＋熱處理（雙合鑫、金元達 H_ 料號）＋表面處理加工費（Z04…，對照在設定 › 加工成本），每 KG 乘單重。量少一批的低消（數量 1、單價 ≥100）不算單價。平華司沒有進價時，用阡阡牌價 × 倍數（預設 1.24）。

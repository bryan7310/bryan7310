---
name: "youtube-auto-upload"
description: "把影片自動上傳到 YouTube：看影片內容自動寫標題與說明（含章節、hashtag），設為公開、關閉留言、非兒童專屬，付費宣傳與 AI 變造內容選「否」，透過內建瀏覽器在 YouTube Studio 完成發布。使用者給影片檔或資料夾並說「上傳 YouTube」「幫我發片」「自動上傳」時使用。"
---

# YouTube 自動上傳

使用者給一支或多支影片（檔案或資料夾，常在 `C:\Users\bryan\Downloads\<資料夾>`），要上傳到 YouTube。Claude 負責看內容、寫標題說明、在 YouTube Studio 設定並發布。回覆一律用繁體中文。

## 0. 預設設定（使用者沒另外說就照這個，不用再問）
- 瀏覽權限：**公開**
- 留言：**關閉**
- 觀眾：**非兒童專屬**（`VIDEO_MADE_FOR_KIDS_NOT_MFK`）
- 付費宣傳：**否**；AI 變造／合成內容：**否**
- 標題、說明：Claude 依影片內容自動寫（見第 2 節）。使用者有給標題就用他的。
- 頻道簽名（說明欄結尾）：`仲仲與心心｜來自台灣的兄妹日常 🇹🇼`（使用者說是別的頻道就改掉或省略）

只有影片內容看不出主題、或使用者的指示跟預設衝突時才問。

## 1. 收集影片
- 列出資料夾裡的 `.mp4 / .mov / .mkv / .webm`，跳過 `.jpg/.png`（縮圖另外處理）、檔名含「草稿」「temp」的檔案。
- 用 `ffprobe` 取得每支的長度與長寬：**直式且 ≤ 3 分鐘 → Shorts**；其餘是一般影片。
- 檔名有「繁中」「英文 / EN」字樣時，對應中文或英文的標題說明。沒寫就看影片語言決定。

## 2. 看影片、寫標題與說明
每支影片：
1. **看畫面**：`ffmpeg -i in.mp4 -vf "fps=1/間隔,scale=480:-1" f_%03d.jpg`，間隔取「長度 ÷ 12」（最少 2 秒），用 Read 看這些圖。
2. **聽內容**（有講話時）：`ffmpeg -i in.mp4 -ac 1 -ar 16000 a.wav`，有 `whisper-cli`（或 `whisper`）就轉文字，例如
   `whisper-cli -m turbo -f a.wav -l zh --vad -mc 0 -osrt -of a --prompt "以下是繁體中文。"`
   沒有語音辨識工具就只靠畫面，加上檔名。已知誤聽：星星/希希=心心，重重/總總/東東=仲仲。
3. **標題**：≤ 60 字，具體、有畫面感、可以帶 1 個 emoji，不要誇大不實的釣魚字眼。Shorts 標題結尾加 ` #shorts`。
4. **說明欄**格式：
   ```
   <1–2 句介紹影片在做什麼、好看在哪>

   <章節（只有長度 > 3 分鐘、且找得到 3 段以上明顯段落時才寫；第一行必須是 00:00）>
   00:00 開場
   01:23 …

   <頻道簽名>
   #標籤1 #標籤2 #標籤3（3–5 個）
   ```
   英文影片整段用英文寫（簽名改成 `Zhongzhong & Xinxin | Sibling life from Taiwan 🇹🇼`）。
5. 把每支的「檔名 → 標題／說明」整理成一張表給使用者看一眼，**然後直接繼續上傳，不必等回覆**（使用者要求先確認時才停）。

## 3. 開啟 YouTube Studio
- 先載入 built-in-browser 技能；對 `studio.youtube.com` 和 `accounts.google.com` 用 request_access(site)。
- 沒登入時請使用者自己登入（密碼、驗證碼不能代打）。出現「建立密碼金鑰」可以按「暫時不要」。
- 開 `https://studio.youtube.com/channel/UC/videos/upload?d=ud`。

## 4. 選檔（需要使用者動手一次）
- 系統選檔視窗 Claude 點不到（RustDesk 等視窗常擋在前面），所以請使用者按「選取檔案」，**按住 Ctrl 一次多選**所有要上傳的影片（縮圖 jpg 不要選）。
- 多選上傳後每支都會變成草稿。

## 5. 發布草稿（每支影片）
在影片清單找到該列 → 按「編輯草稿」→ 在對話框裡只做：
1. 勾 `VIDEO_MADE_FOR_KIDS_NOT_MFK`
2. 連按 3 次 `#next-button`
3. 點 `tp-yt-paper-radio-button[name=PUBLIC]`
4. 按 `#done-button`，**等到出現「影片已發布／處理中」才離開**（存檔中途換頁會失敗；瀏覽器面板被隱藏時會很慢）。

草稿對話框裡改標題常常存不進去，所以標題說明放到下一步。影片 ID 在網址的 `udvid=` 後面，記下來。

## 6. 設定標題、說明、留言（每支影片）
到 `https://studio.youtube.com/video/<ID>/edit`，用 JS 設定：
- **標題、說明**：頁面有兩個 `#textbox[contenteditable]`（第一個是標題、第二個是說明），各自
  `el.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, text)`。
- 確認 `VIDEO_MADE_FOR_KIDS_NOT_MFK` 是勾選的。
- 按「顯示更多」，點 `VIDEO_PAID_PRODUCT_PLACEMENT_NO`、`VIDEO_HAS_ALTERED_CONTENT_NO`。
- **留言**：找 `ytcp-select` 裡 textContent 以「留言」開頭的那一個，點它的 trigger，再點 `tp-yt-paper-item[role=option]` 中 **textContent**（不是 innerText）等於「關閉」的選項。
- 按 `#save`，等存檔完成。
- 回到內容清單，確認標題正確、瀏覽權限顯示「公開」。

## 7. 縮圖（選用）
資料夾裡有跟影片同名（或含相同主題字）的 jpg/png 時，自訂縮圖也需要使用者在選檔視窗點選。全部影片處理完後，一次列出「哪支影片 → 哪張縮圖」請使用者補上。

## 8. 常見問題
- **每日上傳上限**：未驗證頻道一天約 10 支，畫面出現「已達每日上傳數量上限」時停下，請使用者到 https://www.youtube.com/verify 做手機驗證，或用 send_later 排 24 小時後的提醒再繼續剩下的。
- **版權聲明／檢查中**：不影響發布，回報給使用者即可。
- 頁面元素找不到時先截圖看實際畫面，YouTube Studio 改版時選擇器可能變，依畫面上的文字找對應按鈕。

## 9. 收尾回報
用繁體中文列出：
- 已發布：標題、`https://youtu.be/<ID>`、設定（公開／留言關閉）
- 未完成：哪幾支、原因（上限、選檔、錯誤）
- 待使用者補的縮圖清單

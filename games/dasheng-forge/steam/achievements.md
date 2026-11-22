# Steam 成就設定

在 Steamworks 後台「Stats & Achievements」逐一新增，**API Name 要和左欄完全一樣**，程式才解得開。圖示要 64 × 64 的 JPG，一張已解鎖、一張未解鎖（灰階）。

| API Name | 中文名稱 | 英文名稱 | 解鎖條件 |
| --- | --- | --- | --- |
| FIRST_WIN | 初次降妖 | First Demon Down | 打贏第一場 |
| FIRST_GEM | 石中有寶 | Something Inside | 切出第一顆寶石 |
| GEM_LARGE | 大品到手 | A Large One | 擁有大品以上寶石 |
| GEM_PERFECT | 極品現世 | Perfect Gem | 擁有極品寶石 |
| FUSE_FAIL_3 | 火候未到 | Not Hot Enough | 合成失敗累計 3 次 |
| FLIP_500 | 轉手高手 | Stone Trader | 轉手原石累計賺 500 兩 |
| BEAT_BONE | 三打白骨精 | White Bone Defeated | 打過第 4 難 |
| BEAT_REDBOY | 滅了三昧火 | Fire Put Out | 打過第 8 難 |
| BEAT_BULL | 取經功德圓滿 | Journey Complete | 打過第 12 難 |
| RUYI_STAFF | 如意金箍棒 | Ruyi Golden Staff | 兵器打造到第 3 階 |
| FULL_SET | 齊天大聖全套 | Great Sage Equipped | 三件裝備都到第 3 階 |
| COUNTER_BOSS | 五行相剋 | Elemental Counter | 用剋制屬性打倒任一頭目 |

條件寫在 `game/app.js` 的 `ACH` 清單。新增成就時，後台和程式兩邊要一起改。

# 大聖煉寶（DashengForge）

孫悟空西行闖關、賭石切寶石、合成寶石、打造裝備的單機遊戲。這個資料夾是可以打包上 Steam 的完整專案；設計文件、劇本、美術需求在 Claude Docs 的「大聖煉寶 遊戲設計與上架框架」。

## 資料夾

| 路徑 | 內容 |
| --- | --- |
| `game/` | 遊戲本體（網頁技術）：`index.html`、`style.css`、`engine.js`（規則與數值）、`app.js`（畫面） |
| `game/assets/` | 美術圖放這裡，檔名規則見該資料夾的 `README.md` |
| `electron/` | 桌面版外殼：開視窗、接 Steam 成就、存檔寫檔 |
| `steam/` | Steam 後台要設定的成就清單、SteamPipe 上傳範本 |
| `scripts/build-web.js` | 產生單檔網頁試玩版 |
| `art/prompts.md` | 每張 AI 美術圖的提示詞紀錄（Steam AI 揭露用） |

## 開發

需要 Node.js 20 以上。

```bash
npm install          # 第一次
npm start            # 開桌面版（沒開 Steam 也能玩，只是不會解成就）
npm run web          # 產生 dist/web/index.html 單檔試玩版
```

只改畫面或數值時，直接用瀏覽器開 `game/index.html` 也能玩。

## 放美術圖

1. 圖存成 PNG，照 `game/assets/README.md` 的檔名放進 `game/assets/`。
2. 在 `game/assets/manifest.js` 把檔名加進清單。
3. 重開遊戲就會看到新圖；沒放圖的地方繼續用內建圖形。

## 打包與上傳 Steam

1. **改 App ID**：把 `steam_appid.txt` 的 `480`（Valve 的測試用 App）換成自己的 App ID。
2. **打包**：`npm run dist:win`，輸出在 `dist/win-unpacked/`。Steam 直接發佈這個資料夾，不需要安裝程式。
3. **上傳**：改好 `steam/app_build.vdf` 裡的 App ID 與 Depot ID，用 Valve 的 `steamcmd` 執行 `+run_app_build`。
4. **後台設定**：
   - 成就照 `steam/achievements.md` 建立，API Name 要一字不差。
   - Steam Cloud 用 Auto-Cloud：根目錄選 `WinAppDataRoaming`，子資料夾 `DashengForge`，檔案 `save.json`（macOS 對應 `MacAppSupport`，Linux 對應 `LinuxXdgDataHome` 或 `~/.config`，依後台選項設定）。
   - 啟動選項的執行檔填 `DashengForge.exe`。

## 已知事項

- 字型目前從 Google Fonts 載入，離線時會退回系統字型。正式版建議把 Noto Serif TC、Noto Sans TC、霞鶩文楷（皆為 SIL Open Font License）下載放進 `game/fonts/`，改成本機載入。
- `steamworks.js` 0.4.0 是 2024 年的版本，搭配 Electron 45 在 Linux 上載入正常；Windows 版與 Steam 疊加介面要在裝了 Steam 的電腦上實測。
- 遊戲邏輯不依賴網路，桌面版不需要連線。

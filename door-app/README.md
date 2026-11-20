# 開門 App（Smart Life + 易微聯 合併）

一個網頁 App，把 **Smart Life（Tuya）** 的捲門和 **易微聯（eWeLink）** 的鐵門開關放在同一個畫面控制。
在 iPhone Safari 打開網址，按「分享 →加入主畫面」，就會像一般 App 一樣出現在主畫面。不需要 Mac，也不需要上架 App Store。

- 開門前會跳出確認，避免誤觸
- 需要密碼才能使用，密碼錯 10 次會鎖 15 分鐘
- 自動抓兩邊帳號裡的所有裝置，新增裝置不用改程式

## 架構

```
iPhone（網頁 App） → Cloudflare Worker（保管金鑰、檢查密碼） → Tuya 雲端 API
                                                         → eWeLink 雲端 API
```

| 檔案 | 用途 |
|---|---|
| `src/worker.js` | 後端：登入、裝置清單、開門指令、易微聯授權 |
| `src/tuya.js` | Tuya OpenAPI（簽名、token、裝置、指令） |
| `src/ewelink.js` | eWeLink API v2（OAuth 授權、token 更新、裝置、指令） |
| `src/demo.js` | 展示模式的假資料 |
| `public/` | 手機畫面（HTML / CSS / JS、圖示） |
| `test/` | 自動測試（`npm test`） |

## 需要準備的帳號（都免費）

### 1. Tuya 開發者帳號（控制 Smart Life 的門）
1. 到 <https://iot.tuya.com> 註冊並登入。
2. 「Cloud → Development → Create Cloud Project」，開發方式選 **Smart Home**，資料中心選你 Smart Life 帳號所在的地區。
3. 建好後，在專案的「Overview」頁抄下 **Access ID/Client ID** 和 **Access Secret/Client Secret**。
4. 到「Devices → Link App Account → Add App Account」，畫面會出現 QR Code。用手機 Smart Life App 的「我的 → 右上角掃描」掃它，你的門就會出現在 Tuya 後台。
5. 到「Service API」，確認已訂閱 **IoT Core**（免費試用版即可，到期後按續約）。

資料中心對應的網址（設定 `TUYA_ENDPOINT` 用）：

| 資料中心 | 網址 |
|---|---|
| 美西 Western America | `https://openapi.tuyaus.com` |
| 美東 Eastern America | `https://openapi-ueaz.tuyaus.com` |
| 中國 China | `https://openapi.tuyacn.com` |
| 中歐 Central Europe | `https://openapi.tuyaeu.com` |
| 西歐 Western Europe | `https://openapi-weaz.tuyaeu.com` |
| 印度 India | `https://openapi.tuyain.com` |

### 2. 易微聯開發者帳號（控制 88 號鐵門）
1. 到 <https://dev.ewelink.cc> 註冊並登入（可用原本的易微聯帳號）。
2. 建立應用，抄下 **APPID** 和 **APP SECRET**。
3. 「Redirect URL」填：`https://你的網址/oauth/ewelink/callback`（網址在第 3 步部署後才會知道，可以之後再回來填）。

### 3. Cloudflare 帳號（放 App 的地方）
到 <https://dash.cloudflare.com/sign-up> 註冊。免費方案就夠用。

## 部署

```bash
cd door-app
npm install
npx wrangler login                          # 登入 Cloudflare
npx wrangler kv namespace create DOOR_KV    # 把輸出的 id 貼到 wrangler.toml
npx wrangler secret put APP_PASSWORD        # App 密碼，請設長一點
npx wrangler secret put TUYA_CLIENT_ID
npx wrangler secret put TUYA_SECRET
npx wrangler secret put EWELINK_APPID
npx wrangler secret put EWELINK_APPSECRET
npx wrangler deploy                         # 會印出網址，例如 https://door-app.xxx.workers.dev
```

如果 Tuya 資料中心不是美西，請改 `wrangler.toml` 裡的 `TUYA_ENDPOINT`。

部署後：
1. 手機用 Safari 打開網址，輸入 App 密碼。
2. 點畫面上的「連結易微聯」，登入易微聯帳號，88 號鐵門就會出現。
3. 按「分享 → 加入主畫面」。

## 本機預覽（不用任何帳號）

```bash
npm install
npm run demo     # 打開 http://localhost:8787 ，密碼 demo
```

展示模式用假資料，不會控制真的門。

## 測試

```bash
npm test
```

## 常見問題
- **Smart Life 裝置沒出現**：通常是 `TUYA_ENDPOINT` 的資料中心選錯，或 IoT Core 試用到期。
- **易微聯顯示「登入已過期」**：重新按「連結易微聯」即可（約 60 天沒使用才會發生）。
- **store98 按了沒反應**：裝置離線時按鈕會變灰，請先讓它重新連上 Wi-Fi。

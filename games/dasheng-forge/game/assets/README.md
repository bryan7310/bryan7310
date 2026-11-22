# 美術素材資料夾

ChatGPT 產生的圖存在這裡，一律 PNG，檔名要完全照下表。放好後，記得把檔名（不含 `.png`）加進 `manifest.js` 的清單，遊戲才會用。

| 類別 | 尺寸（像素） | 背景 | 檔名 |
| --- | --- | --- | --- |
| 悟空頭像 | 512 × 512 | 透明 | `wukong` |
| 妖怪 | 512 × 512 | 透明 | `demon_shanxiao`、`demon_yellow`、`demon_spider`、`demon_bone`、`demon_bear`、`demon_fan`、`demon_redboy`、`demon_bull`、`demon_shrimp`、`demon_crab`、`demon_soldier`、`demon_dragon` |
| 寶石 | 256 × 256 | 透明 | `gem_<屬性>_<等級>`，屬性是 `metal` `wood` `water` `fire` `earth`，等級 1 到 5，例如 `gem_fire_3` |
| 原石 | 256 × 256 | 透明 | `stone_rough`、`stone_mount`、`stone_fairy` |
| 裝備 | 256 × 256 | 透明 | `weapon_1` 到 `weapon_3`、`armor_1` 到 `armor_3`、`crown_1` 到 `crown_3` |
| 材料 | 128 × 128 | 透明 | `mat_bone`、`mat_hide`、`mat_core` |
| 背景 | 1920 × 1080 | 有 | `bg_stall`（賭石分頁）、`bg_forge`（煉器分頁） |

`wukong_happy`、`wukong_hurt`、配角頭像和三章的背景 `bg_ch1` 到 `bg_ch3` 已列在設計文件，程式之後再接上。

網頁試玩版會用 `scripts/make-webp.py` 另外壓一份 WebP（放在 `dist/web-assets/`），這裡只放 PNG 原檔。

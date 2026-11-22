// 桌面版主程式：開視窗載入 game/index.html，並在有 Steam 時接上成就與存檔。
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- Steam ----------
// 從 Steam 啟動時會連上 Steam；沒有 Steam（例如開發中直接執行）就略過，遊戲照常可玩。
let steam = null;
try {
  const steamworks = require('steamworks.js');
  steam = steamworks.init(); // 沒給 App ID 時讀取專案根目錄的 steam_appid.txt
  steamworks.electronEnableSteamOverlay();
  console.log('[steam] connected as', steam.localplayer.getName());
} catch (err) {
  console.log('[steam] not available, running without Steam:', err.message);
}

// ---------- 存檔 ----------
// 存在使用者資料夾的 save.json，Steam 後台設定 Auto-Cloud 同步這個檔案。
const saveFile = () => path.join(app.getPath('userData'), 'save.json');

ipcMain.handle('save:read', () => {
  try { return fs.readFileSync(saveFile(), 'utf8'); } catch { return null; }
});
ipcMain.handle('save:write', (_e, json) => {
  if (typeof json !== 'string' || json.length > 5_000_000) return false;
  const tmp = saveFile() + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, saveFile()); // 先寫暫存檔再改名，避免寫到一半當機壞檔
  return true;
});

// ---------- 成就 ----------
ipcMain.handle('steam:unlock', (_e, id) => {
  if (!steam || typeof id !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(id)) return false;
  try { return steam.achievement.activate(id); } catch { return false; }
});
ipcMain.handle('steam:available', () => !!steam);

// ---------- 視窗 ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0c1613',
    title: '大聖煉寶',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'game', 'index.html'));
  // F11 全螢幕，Steam Deck 與大螢幕適用
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

app.setName('DashengForge'); // 決定存檔資料夾名稱，Steam 雲端設定要用同一個名字
Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

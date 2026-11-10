// 資料層：一開始整批載入所有即時集合，之後用 long-polling 接收別台電腦的修改。
// 修改先套用在本機（畫面立刻更新），再送到伺服器；失敗就還原並提示。
import { api } from './api.js';
import { uid } from './util.js';

const CACHE_DB = 'zhirui-cache', CACHE_KEY = 'bootstrap';

function idb(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(CACHE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { try { const tx = r.result.transaction('kv', mode); const q = fn(tx.objectStore('kv')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); } catch (e) { rej(e); } };
  });
}

class Store {
  constructor() {
    this.cols = {};          // col -> Map(id -> doc)
    this.ver = 0;
    this.user = null;
    this.users = [];
    this.hist = 0;
    this.subs = new Set();
    this.state = 'init';     // init | live | offline | error
    this.msg = '';
    this.gen = 0;            // 任何資料變動就 +1（快取失效用）
    this.pending = 0;
    this.saveT = 0;
  }
  col(c) { return this.cols[c] || (this.cols[c] = new Map()); }
  list(c) { return [...this.col(c).values()]; }
  get(c, id) { return this.col(c).get(id) || null; }

  // ---------- 啟動 ----------
  async boot() {
    let cached = null;
    try { cached = await idb('readonly', s => s.get(CACHE_KEY)); } catch (e) {}
    const me = await api.get('/api/me');
    this.user = me.user; this.histVer = (me.status && me.status.histVer) || '';
    if (cached && cached.ver && cached.ver <= me.ver && cached.uid === me.user.id) {
      for (const [c, arr] of Object.entries(cached.cols)) this.cols[c] = new Map(arr.map(d => [d.id, d]));
      this.ver = cached.ver; this.users = cached.users || []; this.hist = cached.hist || 0;
      this.gen++;
      // 補上快取之後的變更
      const s = await api.sync(this.ver);
      this.applyChanges(s.changes); this.ver = s.ver;
    } else {
      const b = await api.bootstrap();
      for (const [c, arr] of Object.entries(b.cols)) this.cols[c] = new Map(arr.map(d => [d.id, d]));
      this.ver = b.ver; this.users = b.users || []; this.hist = b.hist || 0; this.gen++;
      this.saveCache();
    }
    this.state = 'live';
    this.loop();
  }
  saveCache() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => {
      const cols = {}; for (const [c, m] of Object.entries(this.cols)) cols[c] = [...m.values()];
      idb('readwrite', s => s.put({ ver: this.ver, uid: this.user && this.user.id, users: this.users, hist: this.hist, cols }, CACHE_KEY)).catch(() => {});
    }, 1500);
  }
  async clearCache() { try { await idb('readwrite', s => s.delete(CACHE_KEY)); } catch (e) {} }
  /** 其他要留在這台瀏覽器的大資料（例如舊系統歷史單據），讀不到就回 null */
  async cacheGet(key) { try { return (await idb('readonly', s => s.get(key))) ?? null; } catch (e) { return null; } }
  async cachePut(key, val) { try { await idb('readwrite', s => s.put(val, key)); } catch (e) {} }
  /** 清掉這台瀏覽器的暫存（開機資料、舊系統單據），下次重新向伺服器下載 */
  async cacheClear() { try { await idb('readwrite', s => s.clear()); } catch (e) {} }

  // ---------- 即時同步 ----------
  async loop() {
    let fails = 0;
    while (true) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 40000);
        const s = await api.sync(this.ver, ctrl.signal);
        clearTimeout(t);
        fails = 0;
        if (this.state !== 'live') { this.state = 'live'; this.msg = ''; this.emit(new Set()); }
        if (s.changes && s.changes.length) {
          const changed = this.applyChanges(s.changes, true);
          this.ver = s.ver;
          this.emit(changed);
          this.saveCache();
        } else this.ver = s.ver;
      } catch (e) {
        if (e.status === 401) { this.state = 'offline'; this.msg = '登入已失效，請重新登入'; this.emit(new Set()); location.reload(); return; }
        fails++;
        this.state = 'error'; this.msg = '連不到伺服器，正在重試…'; this.emit(new Set());
        await new Promise(r => setTimeout(r, Math.min(15000, 1000 * fails)));
      }
    }
  }
  applyChanges(changes, remote) {
    const changed = new Set();
    for (const ch of changes) {
      const m = this.col(ch.col);
      if (ch.data == null) m.delete(ch.id); else m.set(ch.id, ch.data);
      changed.add(ch.col);
    }
    if (changed.size) this.gen++;
    return changed;
  }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(changed) { for (const fn of this.subs) { try { fn(changed); } catch (e) { console.error(e); } } }

  // ---------- 寫入 ----------
  async save(col, id, data) { return this.batch([{ col, id, data }]); }
  async remove(col, id) { return this.batch([{ col, id, delete: true }]); }
  async batch(ops) {
    const undo = [];
    const changed = new Set();
    for (const op of ops) {
      if (!op.id) op.id = uid();
      const m = this.col(op.col);
      undo.push({ col: op.col, id: op.id, prev: m.get(op.id) || null });
      if (op.delete) m.delete(op.id); else m.set(op.id, { ...op.data, id: op.id, _by: this.user && this.user.id });
      changed.add(op.col);
    }
    this.gen++; this.pending++; this.emit(changed);
    try {
      const r = await api.batch(ops.map(o => o.delete ? { col: o.col, id: o.id, delete: true } : { col: o.col, id: o.id, data: o.data }));
      this.pending--; this.saveCache();
      return r;
    } catch (e) {
      this.pending--;
      for (const u of undo) { const m = this.col(u.col); if (u.prev) m.set(u.id, u.prev); else m.delete(u.id); }
      this.gen++; this.emit(changed);
      throw e;
    }
  }
  // 操作日誌
  log(action, what) {
    const id = uid('l');
    this.batch([{ col: 'logs', id, data: { action, what, at: Date.now(), uid: this.user && this.user.id, who: this.user && this.user.name } }]).catch(() => {});
  }
  setting(id) { return this.get('settings', id) || {}; }
  saveSetting(id, data) { return this.save('settings', id, data); }
}

export const store = new Store();

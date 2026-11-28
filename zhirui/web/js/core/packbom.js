// 包裝排程 → 看這個螺絲包的配方（goods.bom）：每包幾個、這筆排程共需多少、還要用多少、零件庫存夠不夠。
// 電腦版「包裝螺絲」（modules/packs.js）和 App／平板「包裝排程」（m/packlist.js）共用。
import { store } from './store.js';
import { calc } from './calc.js';

const num = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
/** o：一筆包裝排程。回傳 { g, need, left, labor, rows: [{ gid, name, code, unit, per, total, rest, stock, cust, short }] }；沒有配方 rows 是空的 */
export function packBom(o) {
  const g = o.gid ? store.get('goods', o.gid) : null; const need = num(o.qty);
  const got = (o.logs || []).reduce((a, l) => a + num(l.qty), 0); const left = Math.max(0, +(need - got).toPrecision(10));
  const C = calc(); const r4 = v => +(+v).toPrecision(10);
  const rows = (g?.bom || []).map(x => {
    const p = x.gid ? store.get('goods', x.gid) : null; const per = +x.qty || 0; const st = C.stock[x.gid] || {};
    const stock = x.cust && g.cwid ? (st[g.cwid] || 0) : Object.values(st).reduce((a, b) => a + b, 0);
    const rest = r4(per * left);
    return { gid: x.gid, name: p?.name || '（零件已刪除）', code: p?.code || '', unit: p?.unit || '', per, total: r4(per * need), rest, stock, cust: !!x.cust, short: !(o.steps || {}).done && rest > 0 && stock < rest };
  });
  return { g, need, left, labor: +g?.labor || 0, rows };
}

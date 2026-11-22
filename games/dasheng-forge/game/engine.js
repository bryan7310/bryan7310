// ===== 大聖煉寶：核心（不碰 DOM，可在 node 模擬） =====
const ELEMENTS = ['metal', 'wood', 'water', 'fire', 'earth'];
// 五行相剋：A 剋 B
const BEATS = { metal: 'wood', wood: 'earth', earth: 'water', water: 'fire', fire: 'metal' };
// 寶石每級加成（index = 等級 1..5）
const GEM_STAT = {
  metal: [0, 3, 7, 16, 36, 80],     // 攻擊
  water: [0, 2, 4, 9, 20, 44],      // 防禦
  earth: [0, 15, 35, 80, 180, 400], // 生命
  fire:  [0, 3, 6, 10, 15, 22],     // 爆擊率 %
  wood:  [0, 2, 4, 9, 20, 44],      // 每回合回血
};
const GEM_PRICE = [0, 15, 55, 200, 750, 2800]; // 賣給當舖
const FUSE_RATE = [0, 1, 0.85, 0.65, 0.45];    // 從 g 升到 g+1 的成功率

const STONES = [
  { key: 'rough', price: 40,  w: [0.45, 0.35, 0.15, 0.05, 0, 0],          unlock: 0 },
  { key: 'mount', price: 180, w: [0.40, 0.18, 0.24, 0.13, 0.05, 0],       unlock: 3 },
  { key: 'fairy', price: 900, w: [0.36, 0.04, 0.18, 0.22, 0.14, 0.06],    unlock: 7 },
];

const EQUIP = {
  weapon: [
    { atk: 0 },
    { atk: 6,  cost: { bone: 3, silver: 120 }, sockets: 1 },
    { atk: 16, cost: { bone: 7, core: 1, silver: 600 }, sockets: 2 },
    { atk: 40, cost: { bone: 12, core: 4, silver: 2500 }, sockets: 3 },
  ],
  armor: [
    { def: 0, hp: 0 },
    { def: 3,  hp: 30,  cost: { hide: 3, silver: 120 }, sockets: 1 },
    { def: 8,  hp: 80,  cost: { hide: 7, core: 1, silver: 600 }, sockets: 2 },
    { def: 20, hp: 220, cost: { hide: 12, core: 4, silver: 2500 }, sockets: 3 },
  ],
  crown: [
    { crit: 0 },
    { crit: 5,  cost: { bone: 2, hide: 2, silver: 150 }, sockets: 1 },
    { crit: 10, cost: { bone: 4, hide: 4, core: 2, silver: 800 }, sockets: 2 },
    { crit: 18, cost: { bone: 8, hide: 8, core: 5, silver: 3000 }, sockets: 3 },
  ],
};

const DEMONS = [
  { key: 'shanxiao',  el: 'earth',    hp: 63,    atk: 9,   def: 1,   silver: 90,   drop: { bone: 1, hide: 1 } },
  { key: 'yellow',    el: 'earth',    hp: 108,   atk: 13,  def: 3,   silver: 140,  drop: { bone: 1, hide: 2 } },
  { key: 'spider',    el: 'wood',     hp: 153,   atk: 15,  def: 4,   silver: 190,  drop: { bone: 1, hide: 3, core: 1 } },
  { key: 'bone',      el: 'metal',    hp: 297,   atk: 22,  def: 7,   silver: 520,  drop: { bone: 4, core: 1 }, boss: true },
  { key: 'bear',      el: 'earth',    hp: 342,   atk: 25,  def: 10,  silver: 440,  drop: { bone: 3, hide: 2 } },
  { key: 'fan',       el: 'wood',     hp: 405,   atk: 28,  def: 12,  silver: 520,  drop: { bone: 2, hide: 3 } },
  { key: 'redboy',    el: 'fire',     hp: 504,   atk: 32,  def: 15,  silver: 640,  drop: { hide: 4, core: 1 } },
  { key: 'bull',      el: 'fire',     hp: 810,   atk: 43,  def: 18,  silver: 1300, drop: { bone: 3, hide: 3, core: 2 }, boss: true },
  { key: 'shrimp',    el: 'water',    hp: 900,   atk: 50,  def: 22,  silver: 1200, drop: { bone: 4, hide: 2, core: 1 } },
  { key: 'crab',      el: 'metal',    hp: 1125,  atk: 56,  def: 27,  silver: 1400, drop: { bone: 2, hide: 4, core: 1 } },
  { key: 'soldier',   el: 'metal',    hp: 1350,  atk: 67,  def: 31,  silver: 1700, drop: { bone: 3, hide: 3, core: 2 } },
  { key: 'dragon',    el: 'water',    hp: 2340,  atk: 86,  def: 40,  silver: 4000, drop: { core: 3 }, boss: true },
];
const LEVEL_XP = [0, 20, 60, 130, 240, 400, 620, 900, 1260, 1700, 2250, 2900, 3700, 4600, 5700, 6900, 8300, 9900, 11700, 13700];
const MAX_ROUNDS = 40;

function newGame() {
  return {
    silver: 150, xp: 0, level: 1, cleared: 0, // cleared = 已打通的難數
    mats: { bone: 0, hide: 0, core: 0 },
    gems: [],               // { id, el, g }
    equip: { weapon: { tier: 0, sockets: [] }, armor: { tier: 0, sockets: [] }, crown: { tier: 0, sockets: [] } },
    stall: [], stallTier: 0, nextId: 1,
    stats: { stones: 0, wasted: 0, bestGem: 0, fuses: 0, fuseFails: 0, wins: 0, losses: 0 },
  };
}
function levelFor(xp) { let l = 1; for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) l = i + 1; return l; }

// ---------- 角色數值 ----------
function socketGems(s) { const out = []; for (const k in s.equip) for (const id of s.equip[k].sockets) { const gm = s.gems.find(x => x.id === id); if (gm) out.push({ ...gm, slot: k }); } return out; }
function stats(s) {
  const L = s.level;
  const st = { atk: 8 + 3 * L, def: 2 + L, hp: 70 + 16 * L, crit: 5, regen: 0 };
  const e = s.equip;
  st.atk += EQUIP.weapon[e.weapon.tier].atk;
  st.def += EQUIP.armor[e.armor.tier].def; st.hp += EQUIP.armor[e.armor.tier].hp;
  st.crit += EQUIP.crown[e.crown.tier].crit;
  for (const gm of socketGems(s)) {
    const v = GEM_STAT[gm.el][gm.g];
    if (gm.el === 'metal') st.atk += v; else if (gm.el === 'water') st.def += v;
    else if (gm.el === 'earth') st.hp += v; else if (gm.el === 'fire') st.crit += v; else st.regen += v;
  }
  st.crit = Math.min(75, st.crit);
  st.el = weaponElement(s);
  return st;
}
// 兵器屬性：兵器孔裡等級總和最高的元素
function weaponElement(s) {
  const sum = {};
  for (const id of s.equip.weapon.sockets) { const gm = s.gems.find(x => x.id === id); if (gm) sum[gm.el] = (sum[gm.el] || 0) + gm.g; }
  let best = null, bv = 0;
  for (const k of ELEMENTS) if ((sum[k] || 0) > bv) { bv = sum[k]; best = k; }
  return best;
}
function elementMult(attEl, defEl) {
  if (!attEl || !defEl) return 1;
  if (BEATS[attEl] === defEl) return 1.5;
  if (BEATS[defEl] === attEl) return 0.75;
  return 1;
}

// ---------- 戰鬥（自動，回傳逐回合紀錄） ----------
function fight(s, idx, rng) {
  const d = DEMONS[idx];
  const me = stats(s);
  let hp = me.hp, dhp = d.hp;
  const mult = elementMult(me.el, d.el);
  const back = elementMult(d.el, me.el) > 1 ? 1.25 : 1; // 被剋時妖怪打你也更痛
  const log = [];
  let win = false;
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const crit = rng() * 100 < me.crit;
    let dmg = Math.max(1, Math.round((me.atk * mult - d.def) * (0.9 + rng() * 0.2) * (crit ? 2 : 1)));
    dhp = Math.max(0, dhp - dmg);
    const e = { r, dmg, crit, dhp, hp };
    if (dhp <= 0) { log.push(e); win = true; break; }
    const taken = Math.max(1, Math.round((d.atk * back - me.def) * (0.9 + rng() * 0.2)));
    hp = Math.max(0, hp - taken);
    e.taken = taken;
    if (hp > 0 && me.regen) { const h = Math.min(me.regen, me.hp - hp); hp += h; e.heal = h; }
    e.hp = hp;
    log.push(e);
    if (hp <= 0) break;
  }
  const res = { win, log, mult, demon: idx, maxHp: me.hp, dmax: d.hp };
  if (win) {
    const first = idx >= s.cleared;
    const k = first ? 1 : 0.5; // 重打收益減半
    res.silver = Math.round(d.silver * k);
    res.xp = Math.round(d.hp * 0.12 * k) + (d.boss && first ? 30 : 0);
    res.drop = {};
    for (const m in d.drop) { const n = first ? d.drop[m] : Math.max(m === 'core' ? (rng() < 0.5 ? 1 : 0) : 1, Math.floor(d.drop[m] / 2)); if (n) res.drop[m] = n; }
    s.silver += res.silver;
    for (const m in res.drop) s.mats[m] += res.drop[m];
    const before = s.level;
    s.xp += res.xp; s.level = levelFor(s.xp); res.levelUp = s.level - before;
    if (first) s.cleared = idx + 1;
    res.first = first;
    s.stats.wins++;
    refreshStall(s, rng, true);
  } else {
    res.lost = Math.round(s.silver * 0.2);
    s.silver -= res.lost;
    s.stats.losses++;
  }
  res.done = s.cleared >= DEMONS.length;
  return res;
}

// ---------- 賭石 ----------
function stoneUnlocked(s, i) { return s.cleared >= STONES[i].unlock; }
function pickW(w, r) { let a = 0; for (let i = 0; i < w.length; i++) { a += w[i]; if (r < a) return i; } return w.length - 1; }
function genStone(s, tier, rng) {
  const g = pickW(STONES[tier].w, rng());
  const el = ELEMENTS[Math.floor(rng() * 5)];
  // 外皮線索：顏色 75% 準確；光澤跟等級有關但有雜訊
  const tint = rng() < 0.75 ? el : ELEMENTS[Math.floor(rng() * 5)];
  const sheen = Math.max(0, Math.min(3, Math.round(g * 0.6 + (rng() - 0.5) * 1.8)));
  return { id: s.nextId++, tier, g, el, tint, sheen, peeked: false, range: null, offer: 0, cut: false, shape: Math.floor(rng() * 4) };
}
function refreshStall(s, rng, free) {
  const tier = stoneUnlocked(s, s.stallTier) ? s.stallTier : 0;
  if (!free) { const c = refreshCost(s); if (s.silver < c) return false; s.silver -= c; }
  s.stall = [genStone(s, tier, rng), genStone(s, tier, rng), genStone(s, tier, rng)];
  return true;
}
function refreshCost(s) { return Math.round(STONES[s.stallTier].price * 0.15); }
function setStallTier(s, i, rng) { if (!stoneUnlocked(s, i)) return false; s.stallTier = i; s.stall = []; refreshStall(s, rng, true); return true; }
function peekCost(st) { return Math.round(STONES[st.tier].price * 0.25); }
function expectedValue(st) {
  if (!st.range) return STONES[st.tier].price;
  let sum = 0, n = 0;
  for (let g = st.range[0]; g <= st.range[1]; g++) { sum += g === 0 ? 0 : GEM_PRICE[g]; n++; }
  return sum / n;
}
// 擦窗：付錢，看到真屬性與等級範圍，並出現收購價
function peek(s, id, rng) {
  const st = s.stall.find(x => x.id === id);
  if (!st || st.peeked || st.cut) return null;
  const c = peekCost(st); if (s.silver < c) return null;
  s.silver -= c; st.peeked = true;
  const lo = Math.max(0, st.g - (rng() < 0.5 ? 1 : 0));
  st.range = [lo, Math.min(5, lo + 1)];
  st.offer = Math.round(expectedValue(st) * (0.75 + rng() * 0.45) * 1.15);
  return st;
}
function buyCost(st) { return STONES[st.tier].price; }
// 切開：付買價（擦過窗的已經是你的，只要付買價一次）
function cutStone(s, id) {
  const st = s.stall.find(x => x.id === id);
  if (!st || st.cut) return null;
  if (s.silver < buyCost(st)) return null;
  s.silver -= buyCost(st); st.cut = true; s.stats.stones++;
  s.stall = s.stall.filter(x => x !== st);
  if (st.g === 0) { s.stats.wasted++; return { stone: st, gem: null }; }
  const gem = { id: s.nextId++, el: st.el, g: st.g };
  s.gems.push(gem);
  s.stats.bestGem = Math.max(s.stats.bestGem, st.g);
  return { stone: st, gem };
}
// 擦窗後不切，直接轉手：先付買價再拿收購價
function flipStone(s, id) {
  const st = s.stall.find(x => x.id === id);
  if (!st || !st.peeked || st.cut) return null;
  if (s.silver < buyCost(st)) return null;
  s.silver += st.offer - buyCost(st);
  s.stats.flipProfit = (s.stats.flipProfit || 0) + Math.max(0, st.offer - buyCost(st));
  s.stall = s.stall.filter(x => x !== st);
  return { stone: st, profit: st.offer - buyCost(st) };
}

// ---------- 寶石 ----------
function isSocketed(s, id) { for (const k in s.equip) if (s.equip[k].sockets.includes(id)) return true; return false; }
function looseGems(s, el, g) { return s.gems.filter(x => x.el === el && x.g === g && !isSocketed(s, x.id)); }
function fuse(s, el, g, rng) {
  if (g >= 5) return null;
  const pool = looseGems(s, el, g);
  if (pool.length < 3) return null;
  const use = pool.slice(0, 3).map(x => x.id);
  s.gems = s.gems.filter(x => !use.includes(x.id));
  s.stats.fuses++;
  if (rng() < FUSE_RATE[g]) {
    const gem = { id: s.nextId++, el, g: g + 1 };
    s.gems.push(gem);
    s.stats.bestGem = Math.max(s.stats.bestGem, g + 1);
    return { ok: true, gem };
  }
  s.stats.fuseFails++;
  const back = { id: s.nextId++, el, g };
  s.gems.push(back);
  return { ok: false, gem: back };
}
function sellGem(s, id) {
  const gm = s.gems.find(x => x.id === id);
  if (!gm || isSocketed(s, id)) return 0;
  s.gems = s.gems.filter(x => x !== gm);
  s.silver += GEM_PRICE[gm.g];
  return GEM_PRICE[gm.g];
}

// ---------- 裝備 ----------
function canCraft(s, slot) {
  const cur = s.equip[slot].tier;
  const next = EQUIP[slot][cur + 1];
  if (!next) return false;
  for (const k in next.cost) { const have = k === 'silver' ? s.silver : s.mats[k]; if (have < next.cost[k]) return false; }
  return true;
}
function craft(s, slot) {
  if (!canCraft(s, slot)) return false;
  const e = s.equip[slot], next = EQUIP[slot][e.tier + 1];
  for (const k in next.cost) { if (k === 'silver') s.silver -= next.cost[k]; else s.mats[k] -= next.cost[k]; }
  e.tier++;
  return true;
}
function socket(s, slot, gemId) {
  const e = s.equip[slot];
  if (e.sockets.length >= (EQUIP[slot][e.tier].sockets || 0)) return false;
  if (!s.gems.find(x => x.id === gemId) || isSocketed(s, gemId)) return false;
  e.sockets.push(gemId); return true;
}
function unsocket(s, slot, gemId) { const e = s.equip[slot]; const i = e.sockets.indexOf(gemId); if (i < 0) return false; e.sockets.splice(i, 1); return true; }

if (typeof module !== 'undefined') module.exports = { ELEMENTS, BEATS, GEM_STAT, GEM_PRICE, FUSE_RATE, STONES, EQUIP, DEMONS, LEVEL_XP, newGame, levelFor, stats, weaponElement, elementMult, fight, stoneUnlocked, genStone, refreshStall, refreshCost, setStallTier, peekCost, peek, buyCost, cutStone, flipStone, looseGems, isSocketed, fuse, sellGem, canCraft, craft, socket, unsocket, expectedValue };

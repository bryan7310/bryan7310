// ===== 大聖煉寶 RPG：核心規則（不碰 DOM，可在 node 模擬） =====
const ELEMENTS = ['metal', 'wood', 'water', 'fire', 'earth'];
const BEATS = { metal: 'wood', wood: 'earth', earth: 'water', water: 'fire', fire: 'metal' };
const GEM_STAT = {
  metal: [0, 3, 7, 14, 28, 55],     // 攻擊
  water: [0, 2, 4, 8, 15, 30],      // 防禦
  earth: [0, 15, 35, 70, 140, 280], // 生命
  fire:  [0, 3, 6, 10, 15, 22],     // 爆擊率 %
  wood:  [0, 2, 4, 7, 12, 22],      // 每回合回血
};
const GEM_PRICE = [0, 15, 55, 200, 750, 2800];
const FUSE_RATE = [0, 1, 0.85, 0.65, 0.45];
const STONES = [
  { key: 'rough', price: 40,  w: [0.45, 0.35, 0.15, 0.05, 0, 0] },
  { key: 'mount', price: 180, w: [0.40, 0.18, 0.24, 0.13, 0.05, 0] },
];

// ---------- 師徒 ----------
const HEROES = {
  wukong: { base: { hp: 62, mp: 20, atk: 15, def: 5, spd: 12 }, grow: { hp: 12, mp: 3, atk: 3.2, def: 1, spd: 1 } },
  bajie:  { base: { hp: 88, mp: 14, atk: 11, def: 8, spd: 7 },  grow: { hp: 17, mp: 2, atk: 2.2, def: 2, spd: 0.5 } },
  wujing: { base: { hp: 66, mp: 28, atk: 9, def: 6, spd: 9 },   grow: { hp: 12, mp: 4, atk: 1.6, def: 1.5, spd: 0.7 } },
};
const PARTY = ['wukong', 'bajie', 'wujing'];
// 技能：target = enemy | enemies | ally | allies | self
const SKILLS = {
  smash:   { hero: 'wukong', lv: 1, mp: 4,  target: 'enemy',   power: 1.8 },
  morph:   { hero: 'wukong', lv: 2, mp: 5,  target: 'self',    morph: true },
  eyes:    { hero: 'wukong', lv: 4, mp: 7,  target: 'enemy',   power: 1.5, crit: true, pierce: true },
  clones:  { hero: 'wukong', lv: 6, mp: 11, target: 'enemies', power: 1.15 },
  sweep:   { hero: 'bajie',  lv: 1, mp: 5,  target: 'enemies', power: 0.9 },
  taunt:   { hero: 'bajie',  lv: 2, mp: 3,  target: 'self',    taunt: 2 },
  feast:   { hero: 'bajie',  lv: 4, mp: 5,  target: 'self',    healPct: 0.35 },
  mend:    { hero: 'wujing', lv: 1, mp: 5,  target: 'ally',    healPct: 0.3, heal: 10 },
  guard:   { hero: 'wujing', lv: 3, mp: 7,  target: 'allies',  guard: 2 },
  staff:   { hero: 'wujing', lv: 2, mp: 4,  target: 'enemy',   power: 1.4 },
  revive:  { hero: 'wujing', lv: 5, mp: 12, target: 'fallen',  revivePct: 0.4 },
};
const ITEMS = {
  peach:  { price: 30,  heal: 60, target: 'ally' },
  elixir: { price: 120, revivePct: 0.5, target: 'fallen' },
  dew:    { price: 45,  mp: 15, target: 'ally' },
};

// ---------- 裝備：每人兵器與護甲各 3 階 ----------
const EQUIP = {
  weapon: [
    { atk: 0, sockets: 0 },
    { atk: 6,  sockets: 1, cost: { bone: 3, silver: 120 } },
    { atk: 15, sockets: 2, cost: { bone: 6, core: 1, silver: 500 } },
    { atk: 32, sockets: 3, cost: { bone: 10, core: 3, silver: 1800 } },
  ],
  armor: [
    { def: 0, hp: 0, sockets: 0 },
    { def: 3, hp: 25, sockets: 1, cost: { hide: 3, silver: 120 } },
    { def: 7, hp: 60, sockets: 2, cost: { hide: 6, core: 1, silver: 500 } },
    { def: 15, hp: 140, sockets: 3, cost: { hide: 10, core: 3, silver: 1800 } },
  ],
};

// ---------- 妖怪 ----------
const FOES = {
  // 小妖（第一章各區）
  sprite:   { hp: 43,  atk: 11,  def: 2,  spd: 6,  el: 'earth', xp: 9,  silver: 12, drop: { bone: 0.3, hide: 0.3 } },
  treeimp:  { hp: 50,  atk: 10,  def: 3,  spd: 5,  el: 'wood',  xp: 10, silver: 12, drop: { hide: 0.5 } },
  sandfox:  { hp: 78,  atk: 18, def: 4,  spd: 14, el: 'fire',  xp: 18, silver: 22, drop: { hide: 0.5 } },
  rockling: { hp: 100,  atk: 15, def: 9,  spd: 4,  el: 'metal', xp: 20, silver: 24, drop: { bone: 0.6 } },
  spiderling:{ hp: 78, atk: 16, def: 6,  spd: 12, el: 'wood',  xp: 24, silver: 28, drop: { hide: 0.5, core: 0.05 } },
  webwitch: { hp: 88,  atk: 23, def: 5,  spd: 10, el: 'water', xp: 24, silver: 30, drop: { bone: 0.4, core: 0.05 } },
  bonesoldier:{ hp: 110, atk: 20, def: 9, spd: 9, el: 'metal', xp: 32, silver: 36, drop: { bone: 0.7, core: 0.08 } },
  ghostfox: { hp: 119,  atk: 28, def: 7,  spd: 15, el: 'fire',  xp: 32, silver: 36, drop: { hide: 0.6, core: 0.08 } },
  // 頭目
  shanxiao: { hp: 598, atk: 26, def: 6,  spd: 8,  el: 'earth', xp: 80,  silver: 160, drop: { bone: 3, hide: 2 }, boss: true, aoe: { every: 3, power: 0.7 } },
  yellow:   { hp: 840, atk: 31, def: 9,  spd: 13, el: 'earth', xp: 140, silver: 260, drop: { bone: 2, hide: 3, core: 1 }, boss: true, aoe: { every: 3, power: 0.8 } },
  spider:   { hp: 1300, atk: 40, def: 10, spd: 14, el: 'wood',  xp: 200, silver: 340, drop: { hide: 4, core: 1 }, boss: true, stun: { every: 3 } },
  bone:     { hp: 1575, atk: 39, def: 11, spd: 15, el: 'metal', xp: 400, silver: 800, drop: { bone: 5, core: 2 }, boss: true, aoe: { every: 4, power: 0.75 }, forms: ['metal', 'water', 'earth'] },
};

// ---------- 地圖：第一章 ----------
// 字元：. 草地  , 草叢(遇敵)  = 小路  T 樹  ~ 水  ^ 山壁  S 土地公廟  F 煉器爐  C 寶箱  1-4 頭目  P 起點
// 四個區域只能從頭目那一格通過：花果山 → 黃風嶺 → 盤絲洞 → 白虎嶺
const MAP = [
  '^^^^^^^^^^^^^^^^^^^^^^',
  '^TT..,,,,C.^TT,,,,,,^^',
  '^..P.,,,,,.^TT,,====4^',
  '^..S==.....^,,,,=,^,,^',
  '^..F.=..TT.^,C,,=,^,,^',
  '^,,,.=.....^,,,,=,,TT^',
  '^,,,.=..TT.^,,,,=,,TT^',
  '^^^^^1^^^^^^^^^^3^^^^^',
  '^TT,,=,,,,,^,,,,=,,,,^',
  '^,,,,=,,~~,^,S,,=,~~,^',
  '^,,,,=,,~~,^,,,,=,~~,^',
  '^,,,,======2=====,,,,^',
  '^,C,,,TT,,,^TT,,,,,,,^',
  '^,,,,,TT,,,^TT,,TT,,C^',
  '^^^^^^^^^^^^^^^^^^^^^^',
];
const BLOCKED = new Set(['^', 'T', '~']);
const BOSS_AT = { '1': 'shanxiao', '2': 'yellow', '3': 'spider', '4': 'bone' };
// 各區域的遇敵組合（依頭目進度）
const ZONES = [
  ['sprite', 'treeimp'],
  ['sandfox', 'rockling', 'sprite'],
  ['spiderling', 'webwitch', 'sandfox'],
  ['bonesoldier', 'ghostfox', 'webwitch'],
];
const CHESTS = {
  '1,9': { silver: 80, peach: 2 },
  '12,2': { gem: ['water', 2], silver: 60, dew: 1 },
  '13,20': { gem: ['metal', 2], core: 1, peach: 2 },
  '4,13': { elixir: 1, silver: 200, gem: ['fire', 2] },
};
const ENCOUNTER_RATE = 0.11;
const LEVEL_XP = (lv) => Math.round(28 * Math.pow(lv, 1.7));

function newGame() {
  const heroes = {};
  for (const k of PARTY) heroes[k] = { lv: 1, xp: 0, hp: 0, mp: 0, weapon: { tier: 0, sockets: [] }, armor: { tier: 0, sockets: [] } };
  const s = {
    v: 1, heroes, silver: 120, mats: { bone: 0, hide: 0, core: 0 }, items: { peach: 3, elixir: 1, dew: 1 },
    gems: [], nextId: 1, pos: null, beaten: [], opened: [], steps: 0, stall: [], stallTier: 0,
    battle: null, stats: { wins: 0, losses: 0, stones: 0, fuses: 0, bestGem: 0 },
  };
  for (let r = 0; r < MAP.length; r++) { const c = MAP[r].indexOf('P'); if (c >= 0) s.pos = [r, c]; }
  for (const k of PARTY) { const st = heroStats(s, k); s.heroes[k].hp = st.hp; s.heroes[k].mp = st.mp; }
  return s;
}

// ---------- 能力值 ----------
function gemOf(s, id) { return s.gems.find(g => g.id === id); }
function isSocketed(s, id) { for (const k of PARTY) for (const sl of ['weapon', 'armor']) if (s.heroes[k][sl].sockets.includes(id)) return true; return false; }
function heroStats(s, k) {
  const h = s.heroes[k], b = HEROES[k].base, g = HEROES[k].grow, L = h.lv - 1;
  const st = { hp: Math.round(b.hp + g.hp * L), mp: Math.round(b.mp + g.mp * L), atk: Math.round(b.atk + g.atk * L), def: Math.round(b.def + g.def * L), spd: Math.round(b.spd + g.spd * L), crit: 5, regen: 0 };
  st.atk += EQUIP.weapon[h.weapon.tier].atk;
  st.def += EQUIP.armor[h.armor.tier].def; st.hp += EQUIP.armor[h.armor.tier].hp;
  const sum = {};
  for (const sl of ['weapon', 'armor']) for (const id of h[sl].sockets) {
    const gm = gemOf(s, id); if (!gm) continue;
    const v = GEM_STAT[gm.el][gm.g];
    if (gm.el === 'metal') st.atk += v; else if (gm.el === 'water') st.def += v; else if (gm.el === 'earth') st.hp += v; else if (gm.el === 'fire') st.crit += v; else st.regen += v;
    if (sl === 'weapon') sum[gm.el] = (sum[gm.el] || 0) + gm.g;
  }
  let el = null, bv = 0; for (const e of ELEMENTS) if ((sum[e] || 0) > bv) { bv = sum[e]; el = e; }
  st.el = el; st.crit = Math.min(60, st.crit);
  return st;
}
function elementMult(a, d) { if (!a || !d) return 1; if (BEATS[a] === d) return 1.5; if (BEATS[d] === a) return 0.75; return 1; }
function skillsOf(s, k) { return Object.keys(SKILLS).filter(id => SKILLS[id].hero === k && s.heroes[k].lv >= SKILLS[id].lv); }

// ---------- 地圖移動 ----------
function tileAt(r, c) { return (MAP[r] || '')[c] || '^'; }
function canEnter(s, r, c) {
  const t = tileAt(r, c);
  if (BLOCKED.has(t)) return false;
  return true;
}
function zoneIndex(s) { return Math.min(ZONES.length - 1, ['shanxiao', 'yellow', 'spider'].filter(b => s.beaten.includes(b)).length); }
// 走一步，回傳事件：{ moved, boss, chest, shrine, forge, encounter }
function step(s, dr, dc, rng) {
  if (s.battle) return { moved: false };
  const r = s.pos[0] + dr, c = s.pos[1] + dc;
  if (!canEnter(s, r, c)) return { moved: false };
  const t = tileAt(r, c);
  if (BOSS_AT[t] && !s.beaten.includes(BOSS_AT[t])) return { moved: false, boss: BOSS_AT[t] };
  s.pos = [r, c]; s.steps++;
  const ev = { moved: true, tile: t };
  const key = r + ',' + c;
  if (t === 'C' && !s.opened.includes(key)) { s.opened.push(key); ev.chest = openChest(s, key, rng); }
  if (t === 'S') { ev.shrine = true; s.lastShrine = [r, c]; }
  if (t === 'F') ev.forge = true;
  if (t === ',' && rng() < ENCOUNTER_RATE) ev.encounter = makeEncounter(s, rng);
  return ev;
}
function openChest(s, key, rng) {
  const c = CHESTS[key] || { silver: 50 };
  if (c.silver) s.silver += c.silver;
  for (const it of ['peach', 'elixir', 'dew']) if (c[it]) s.items[it] += c[it];
  for (const m of ['bone', 'hide', 'core']) if (c[m]) s.mats[m] += c[m];
  if (c.gem) { s.gems.push({ id: s.nextId++, el: c.gem[0], g: c.gem[1] }); s.stats.bestGem = Math.max(s.stats.bestGem, c.gem[1]); }
  return c;
}
function makeEncounter(s, rng) {
  const pool = ZONES[zoneIndex(s)];
  const n = 1 + Math.floor(rng() * 2.6);
  return Array.from({ length: Math.min(3, n) }, () => pool[Math.floor(rng() * pool.length)]);
}

// ---------- 戰鬥 ----------
function startBattle(s, foes, rng) {
  const list = foes.map((k, i) => {
    const f = FOES[k];
    return { key: k, i, hp: f.hp, hpMax: f.hp, atk: f.atk, def: f.def, spd: f.spd, el: f.forms ? f.forms[0] : f.el, form: 0, boss: !!f.boss, stun: 0, turns: 0 };
  });
  const party = {};
  for (const k of PARTY) { const st = heroStats(s, k); party[k] = { guard: 0, taunt: 0, defend: false, stun: 0, morph: null, morphT: 0 }; }
  s.battle = { foes: list, party, round: 0, queue: [], log: [], over: null, boss: list.some(f => f.boss) };
  nextRound(s);
  return s.battle;
}
function alive(s, k) { return s.heroes[k].hp > 0; }
function nextRound(s) {
  const b = s.battle; b.round++;
  const actors = [];
  for (const k of PARTY) if (alive(s, k)) actors.push({ side: 'hero', id: k, spd: heroStats(s, k).spd });
  b.foes.forEach(f => { if (f.hp > 0) actors.push({ side: 'foe', id: f.i, spd: f.spd }); });
  actors.sort((a, c) => c.spd - a.spd);
  b.queue = actors;
}
function current(s) { const b = s.battle; while (b.queue.length) { const a = b.queue[0]; if (a.side === 'hero' ? alive(s, a.id) : b.foes[a.id].hp > 0) return a; b.queue.shift(); } return null; }
function rand(rng) { return 0.9 + rng() * 0.2; }
function heroEl(s, k) { const p = s.battle.party[k]; return p.morph || heroStats(s, k).el; }
function dmgTo(atk, mult, def, rng, crit) { return Math.max(1, Math.round((atk * mult - def * 0.6) * rand(rng) * (crit ? 1.75 : 1))); }

// 玩家行動：act = { type: 'attack'|'skill'|'item'|'defend', skill?, item?, target?, el? }
function heroAct(s, act, rng) {
  const b = s.battle, a = current(s);
  if (!a || a.side !== 'hero' || b.over) return null;
  const k = a.id, h = s.heroes[k], st = heroStats(s, k), p = b.party[k];
  const out = { actor: k, type: act.type, hits: [], heals: [], note: null };
  if (p.stun > 0) { p.stun--; out.note = 'stunned'; return finishTurn(s, out, rng); }
  p.defend = false;
  const hitFoe = (f, power, opts = {}) => {
    const crit = opts.crit || rng() * 100 < st.crit;
    const mult = power * elementMult(heroEl(s, k), f.el);
    const d = dmgTo(st.atk, mult, opts.pierce ? 0 : f.def, rng, crit);
    f.hp = Math.max(0, f.hp - d);
    out.hits.push({ foe: f.i, dmg: d, crit, adv: elementMult(heroEl(s, k), f.el) });
  };
  if (act.type === 'attack') { const f = b.foes[act.target]; if (!f || f.hp <= 0) return null; hitFoe(f, 1); }
  else if (act.type === 'defend') { p.defend = true; h.mp = Math.min(st.mp, h.mp + 3); }
  else if (act.type === 'skill') {
    const sk = SKILLS[act.skill]; if (!sk || sk.hero !== k || h.lv < sk.lv || h.mp < sk.mp) return null;
    h.mp -= sk.mp; out.skill = act.skill;
    if (sk.target === 'enemy') { const f = b.foes[act.target]; if (!f || f.hp <= 0) { h.mp += sk.mp; return null; } hitFoe(f, sk.power, { crit: sk.crit, pierce: sk.pierce }); }
    else if (sk.target === 'enemies') b.foes.filter(f => f.hp > 0).forEach(f => hitFoe(f, sk.power));
    else if (sk.morph) { if (!ELEMENTS.includes(act.el)) { h.mp += sk.mp; return null; } p.morph = act.el; p.morphT = 4; out.morph = act.el; }
    else if (sk.taunt) { p.taunt = sk.taunt; }
    else if (sk.healPct && sk.target === 'self') healHero(s, k, Math.round(st.hp * sk.healPct), out);
    else if (sk.target === 'ally') { if (!alive(s, act.target)) { h.mp += sk.mp; return null; } healHero(s, act.target, Math.round(heroStats(s, act.target).hp * sk.healPct + (sk.heal || 0)), out); }
    else if (sk.guard) PARTY.forEach(x => { if (alive(s, x)) b.party[x].guard = sk.guard; });
    else if (sk.revivePct) { if (alive(s, act.target)) { h.mp += sk.mp; return null; } s.heroes[act.target].hp = Math.round(heroStats(s, act.target).hp * sk.revivePct); out.heals.push({ hero: act.target, amt: s.heroes[act.target].hp, revive: true }); }
  } else if (act.type === 'item') {
    const it = ITEMS[act.item]; if (!it || s.items[act.item] <= 0) return null;
    const t = act.target;
    if (it.revivePct) { if (alive(s, t)) return null; s.heroes[t].hp = Math.round(heroStats(s, t).hp * it.revivePct); out.heals.push({ hero: t, amt: s.heroes[t].hp, revive: true }); }
    else { if (!alive(s, t)) return null; if (it.heal) healHero(s, t, it.heal, out); if (it.mp) { const ht = s.heroes[t]; ht.mp = Math.min(heroStats(s, t).mp, ht.mp + it.mp); out.heals.push({ hero: t, mp: it.mp }); } }
    s.items[act.item]--; out.item = act.item;
  }
  // 白骨精變身
  for (const f of b.foes) checkForm(f, out);
  return finishTurn(s, out, rng);
}
function healHero(s, k, amt, out) { const h = s.heroes[k], mx = heroStats(s, k).hp; const v = Math.min(amt, mx - h.hp); h.hp += v; out.heals.push({ hero: k, amt: v }); }
function checkForm(f, out) {
  const def = FOES[f.key];
  if (!def.forms) return;
  const want = f.hp <= f.hpMax / 3 ? 2 : f.hp <= f.hpMax * 2 / 3 ? 1 : 0;
  if (want > f.form && f.hp > 0) { f.form = want; f.el = def.forms[want]; out.transform = { foe: f.i, el: f.el }; }
}
function foeAct(s, rng) {
  const b = s.battle, a = current(s);
  if (!a || a.side !== 'foe' || b.over) return null;
  const f = b.foes[a.id], def = FOES[f.key];
  const out = { foe: f.i, hits: [], note: null };
  f.turns++;
  if (f.stun > 0) { f.stun--; out.note = 'stunned'; return finishTurn(s, out, rng); }
  const living = PARTY.filter(k => alive(s, k));
  const hitHero = (k, power) => {
    const st = heroStats(s, k), p = b.party[k];
    let d = dmgTo(f.atk, power * (elementMult(f.el, heroEl(s, k)) > 1 ? 1.25 : 1), st.def, rng, rng() < 0.05);
    if (p.defend) d = Math.round(d * 0.5);
    if (p.guard > 0) d = Math.round(d * 0.6);
    if (p.taunt > 0) d = Math.round(d * 0.75);
    s.heroes[k].hp = Math.max(0, s.heroes[k].hp - d);
    out.hits.push({ hero: k, dmg: d, ko: s.heroes[k].hp === 0 });
  };
  if (def.aoe && f.turns % def.aoe.every === 0) { out.special = 'aoe'; living.forEach(k => hitHero(k, def.aoe.power)); }
  else if (def.stun && f.turns % def.stun.every === 0) {
    const t = living[Math.floor(rng() * living.length)]; b.party[t].stun = 1; out.special = 'stun'; out.stunned = t; hitHero(t, 0.6);
  } else {
    const taunter = living.find(k => b.party[k].taunt > 0);
    // 目標：有人嘲諷就打他；否則偏向生命比例低的人
    let t = taunter;
    if (!t) { const w = living.map(k => 1.4 - s.heroes[k].hp / heroStats(s, k).hp); let r = rng() * w.reduce((x, y) => x + y, 0); t = living.find((k, i) => (r -= w.at(i)) <= 0) || living[0]; }
    hitHero(t, 1);
  }
  return finishTurn(s, out, rng);
}
function finishTurn(s, out, rng) {
  const b = s.battle; b.queue.shift();
  if (b.foes.every(f => f.hp <= 0)) { b.over = 'win'; out.result = winBattle(s, rng); return out; }
  if (PARTY.every(k => !alive(s, k))) { b.over = 'lose'; out.result = loseBattle(s); return out; }
  if (!current(s)) {
    // 回合結束：回血、狀態倒數
    out.endRound = [];
    for (const k of PARTY) {
      const p = b.party[k];
      if (alive(s, k)) { const st = heroStats(s, k); if (st.regen) { const v = Math.min(st.regen, st.hp - s.heroes[k].hp); s.heroes[k].hp += v; if (v) out.endRound.push({ hero: k, amt: v }); } }
      if (p.guard > 0) p.guard--; if (p.taunt > 0) p.taunt--; if (p.morphT > 0 && --p.morphT === 0) p.morph = null;
    }
    nextRound(s);
  }
  return out;
}
function winBattle(s, rng) {
  const b = s.battle, res = { xp: 0, silver: 0, drop: {}, levelUps: [] };
  for (const f of b.foes) {
    const d = FOES[f.key]; res.xp += d.xp; res.silver += d.silver;
    for (const m in d.drop) { const v = d.drop[m]; const n = v >= 1 ? v : (rng() < v ? 1 : 0); if (n) res.drop[m] = (res.drop[m] || 0) + n; }
    if (!d.boss && rng() < 0.06) { const gm = { id: s.nextId++, el: ELEMENTS[Math.floor(rng() * 5)], g: 1 }; s.gems.push(gm); res.gem = gm; }
    if (d.boss && !s.beaten.includes(f.key)) { s.beaten.push(f.key); res.bossBeaten = f.key; }
  }
  s.silver += res.silver;
  for (const m in res.drop) s.mats[m] += res.drop[m];
  for (const k of PARTY) {
    const h = s.heroes[k];
    if (!alive(s, k)) h.hp = 1; // 戰後倒地者以 1 血站起
    h.xp += res.xp;
    while (h.xp >= LEVEL_XP(h.lv)) { h.xp -= LEVEL_XP(h.lv); h.lv++; const st = heroStats(s, k); h.hp = st.hp; h.mp = st.mp; res.levelUps.push({ hero: k, lv: h.lv, skills: Object.keys(SKILLS).filter(id => SKILLS[id].hero === k && SKILLS[id].lv === h.lv) }); }
  }
  s.stats.wins++;
  if (res.bossBeaten === 'bone') res.chapterClear = true;
  refreshStall(s, rng);
  return res;
}
function loseBattle(s) {
  // 戰敗：回到土地公廟，丟三成銀兩，全員回滿
  const lost = Math.round(s.silver * 0.3); s.silver -= lost;
  s.pos = (s.lastShrine || firstShrine()).slice();
  restAll(s); s.stats.losses++;
  return { lost };
}
function firstShrine() { for (let r = 0; r < MAP.length; r++) { const c = MAP[r].indexOf('S'); if (c >= 0) return [r, c]; } return [1, 1]; }
function endBattle(s) { s.battle = null; }
function restAll(s) { for (const k of PARTY) { const st = heroStats(s, k); s.heroes[k].hp = st.hp; s.heroes[k].mp = st.mp; } }
function restCost(s) { return 10 + 5 * Math.max(...PARTY.map(k => s.heroes[k].lv)); }
function rest(s) { const c = restCost(s); if (s.silver < c) return false; s.silver -= c; restAll(s); return true; }
function buyItem(s, it, n = 1) { const p = ITEMS[it].price * n; if (s.silver < p) return false; s.silver -= p; s.items[it] += n; return true; }

// ---------- 賭石、合成、打造、鑲嵌 ----------
function pickW(w, r) { let a = 0; for (let i = 0; i < w.length; i++) { a += w[i]; if (r < a) return i; } return w.length - 1; }
function stoneUnlocked(s, i) { return i === 0 || s.beaten.includes('yellow'); }
function genStone(s, tier, rng) {
  const g = pickW(STONES[tier].w, rng()), el = ELEMENTS[Math.floor(rng() * 5)];
  const tint = rng() < 0.75 ? el : ELEMENTS[Math.floor(rng() * 5)];
  const sheen = Math.max(0, Math.min(3, Math.round(g * 0.6 + (rng() - 0.5) * 1.8)));
  return { id: s.nextId++, tier, g, el, tint, sheen, peeked: false, range: null, offer: 0, shape: Math.floor(rng() * 4) };
}
function refreshStall(s, rng) { const t = stoneUnlocked(s, s.stallTier) ? s.stallTier : 0; s.stall = [genStone(s, t, rng), genStone(s, t, rng), genStone(s, t, rng)]; }
function peekCost(st) { return Math.round(STONES[st.tier].price * 0.25); }
function peek(s, id, rng) {
  const st = s.stall.find(x => x.id === id); if (!st || st.peeked) return null;
  const c = peekCost(st); if (s.silver < c) return null; s.silver -= c; st.peeked = true;
  const lo = Math.max(0, st.g - (rng() < 0.5 ? 1 : 0)); st.range = [lo, Math.min(5, lo + 1)];
  let ev = 0; for (let g = st.range[0]; g <= st.range[1]; g++) ev += g ? GEM_PRICE[g] : 0; ev /= 2;
  st.offer = Math.round(ev * (0.75 + rng() * 0.45) * 1.15);
  return st;
}
function cutStone(s, id) {
  const st = s.stall.find(x => x.id === id); if (!st) return null;
  const p = STONES[st.tier].price; if (s.silver < p) return null;
  s.silver -= p; s.stall = s.stall.filter(x => x !== st); s.stats.stones++;
  if (!st.g) return { stone: st, gem: null };
  const gm = { id: s.nextId++, el: st.el, g: st.g }; s.gems.push(gm); s.stats.bestGem = Math.max(s.stats.bestGem, gm.g);
  return { stone: st, gem: gm };
}
function flipStone(s, id) {
  const st = s.stall.find(x => x.id === id); if (!st || !st.peeked) return null;
  const p = STONES[st.tier].price; if (s.silver < p) return null;
  s.silver += st.offer - p; s.stall = s.stall.filter(x => x !== st); return { profit: st.offer - p };
}
function looseGems(s, el, g) { return s.gems.filter(x => x.el === el && x.g === g && !isSocketed(s, x.id)); }
function fuse(s, el, g, rng) {
  if (g >= 5) return null; const pool = looseGems(s, el, g); if (pool.length < 3) return null;
  const use = pool.slice(0, 3).map(x => x.id); s.gems = s.gems.filter(x => !use.includes(x.id)); s.stats.fuses++;
  if (rng() < FUSE_RATE[g]) { const gm = { id: s.nextId++, el, g: g + 1 }; s.gems.push(gm); s.stats.bestGem = Math.max(s.stats.bestGem, g + 1); return { ok: true, gem: gm }; }
  const back = { id: s.nextId++, el, g }; s.gems.push(back); return { ok: false, gem: back };
}
function sellGem(s, id) { const gm = gemOf(s, id); if (!gm || isSocketed(s, id)) return 0; s.gems = s.gems.filter(x => x !== gm); s.silver += GEM_PRICE[gm.g]; return GEM_PRICE[gm.g]; }
function canCraft(s, k, slot) {
  const next = EQUIP[slot][s.heroes[k][slot].tier + 1]; if (!next) return false;
  for (const m in next.cost) if ((m === 'silver' ? s.silver : s.mats[m]) < next.cost[m]) return false;
  return true;
}
function craft(s, k, slot) {
  if (!canCraft(s, k, slot)) return false;
  const e = s.heroes[k][slot], next = EQUIP[slot][e.tier + 1];
  for (const m in next.cost) { if (m === 'silver') s.silver -= next.cost[m]; else s.mats[m] -= next.cost[m]; }
  const before = heroStats(s, k); e.tier++; const after = heroStats(s, k);
  s.heroes[k].hp += after.hp - before.hp;
  return true;
}
function socket(s, k, slot, id) {
  const e = s.heroes[k][slot]; if (e.sockets.length >= EQUIP[slot][e.tier].sockets) return false;
  if (!gemOf(s, id) || isSocketed(s, id)) return false;
  const before = heroStats(s, k); e.sockets.push(id); const after = heroStats(s, k);
  s.heroes[k].hp = Math.max(1, s.heroes[k].hp + after.hp - before.hp);
  return true;
}
function unsocket(s, k, slot, id) {
  const e = s.heroes[k][slot], i = e.sockets.indexOf(id); if (i < 0) return false;
  e.sockets.splice(i, 1); const st = heroStats(s, k); s.heroes[k].hp = Math.min(s.heroes[k].hp, st.hp); return true;
}

if (typeof module !== 'undefined') module.exports = { ELEMENTS, BEATS, GEM_STAT, GEM_PRICE, FUSE_RATE, STONES, HEROES, PARTY, SKILLS, ITEMS, EQUIP, FOES, MAP, BLOCKED, BOSS_AT, ZONES, CHESTS, LEVEL_XP, newGame, heroStats, elementMult, skillsOf, tileAt, canEnter, step, startBattle, current, heroAct, foeAct, endBattle, rest, restCost, restAll, buyItem, stoneUnlocked, refreshStall, peekCost, peek, cutStone, flipStone, looseGems, fuse, sellGem, canCraft, craft, socket, unsocket, isSocketed, gemOf, zoneIndex, heroEl, alive };

// 模擬：電腦玩家練功、打造、挑戰頭目，看第一章要打幾場、幾級過關
const E = require('./engine.js');
const rng = Math.random;
const V = process.argv.includes('v');

function botTurn(s) {
  const a = E.current(s); const k = a.id; const h = s.heroes[k]; const st = E.heroStats(s, k);
  const b = s.battle; const foes = b.foes.filter(f => f.hp > 0);
  const low = E.PARTY.filter(x => E.alive(s, x)).sort((x, y) => s.heroes[x].hp / E.heroStats(s, x).hp - s.heroes[y].hp / E.heroStats(s, y).hp)[0];
  const lowPct = s.heroes[low].hp / E.heroStats(s, low).hp;
  const fallen = E.PARTY.find(x => !E.alive(s, x));
  const has = (id) => E.skillsOf(s, k).includes(id) && h.mp >= E.SKILLS[id].mp;
  const best = foes.slice().sort((x, y) => (E.elementMult(E.heroEl(s, k), y.el) - E.elementMult(E.heroEl(s, k), x.el)) || x.hp - y.hp)[0];
  if (fallen && k === 'wujing' && has('revive')) return { type: 'skill', skill: 'revive', target: fallen };
  if (fallen && s.items.elixir > 0 && b.boss) return { type: 'item', item: 'elixir', target: fallen };
  if (k === 'wujing' && lowPct < 0.5 && has('mend')) return { type: 'skill', skill: 'mend', target: low };
  if (lowPct < 0.3 && s.items.peach > 0) return { type: 'item', item: 'peach', target: low };
  if (k === 'wujing' && b.boss && has('guard') && !b.party[k].guard) return { type: 'skill', skill: 'guard' };
  if (k === 'bajie' && foes.length >= 2 && has('sweep')) return { type: 'skill', skill: 'sweep' };
  if (k === 'bajie' && b.boss && has('taunt') && !b.party.bajie.taunt) return { type: 'skill', skill: 'taunt' };
  if (k === 'wukong') {
    const bossF = foes.find(f => f.boss);
    if (bossF && has('morph')) { const want = Object.keys(E.BEATS).find(x => E.BEATS[x] === bossF.el); if (E.heroEl(s, k) !== want) return { type: 'skill', skill: 'morph', el: want }; }
    if (foes.length >= 2 && has('clones')) return { type: 'skill', skill: 'clones' };
    if (has('eyes') && best.hp > st.atk * 2) return { type: 'skill', skill: 'eyes', target: best.i };
    if (has('smash') && best.hp > st.atk) return { type: 'skill', skill: 'smash', target: best.i };
  }
  return { type: 'attack', target: best.i };
}
function fight(s, foes) {
  E.startBattle(s, foes, rng);
  let guard = 0;
  while (!s.battle.over && guard++ < 500) {
    const a = E.current(s);
    if (a.side === 'hero') { let r = E.heroAct(s, botTurn(s), rng); if (!r) r = E.heroAct(s, { type: 'attack', target: s.battle.foes.find(f => f.hp > 0).i }, rng); }
    else E.foeAct(s, rng);
  }
  const win = s.battle.over === 'win'; E.endBattle(s); return win;
}
function shop(s) {
  for (const k of E.PARTY) for (const sl of ['weapon', 'armor']) E.craft(s, k, sl);
  if (s.items.peach < 4 && s.silver > 150) E.buyItem(s, 'peach', 2);
}
function run() {
  const s = E.newGame(); let battles = 0, tries = {}, lvAt = {};
  const order = ['shanxiao', 'yellow', 'spider', 'bone'];
  // 開寶箱的獎勵約略加上
  for (const boss of order) {
    tries[boss] = 0;
    while (!s.beaten.includes(boss) && battles < 300) {
      for (let i = 0; i < 2; i++) { const z = E.ZONES[E.zoneIndex(s)]; const n = 1 + Math.floor(rng() * 2.6); fight(s, Array.from({ length: Math.min(3, n) }, () => z[Math.floor(rng() * z.length)])); battles++; if (rng() < 0.5) E.restAll(s); }
      shop(s); E.restAll(s);
      tries[boss]++; battles++;
      if (fight(s, [boss])) lvAt[boss] = E.PARTY.map(k => s.heroes[k].lv).join('/');
      E.restAll(s);
    }
  }
  return { battles, tries, lvAt, done: s.beaten.length === 4, eq: E.PARTY.map(k => s.heroes[k].weapon.tier + '' + s.heroes[k].armor.tier).join(' ') };
}
if (V) console.log(run());
else {
  const N = 400; let done = 0; const bs = []; const tr = { shanxiao: 0, yellow: 0, spider: 0, bone: 0 }; const lv = {};
  for (let i = 0; i < N; i++) { const r = run(); if (r.done) done++; bs.push(r.battles); for (const k in r.tries) tr[k] += r.tries[k]; for (const k in r.lvAt) (lv[k] = lv[k] || []).push(r.lvAt[k]); }
  bs.sort((a, b) => a - b);
  console.log('done', done / N, 'battles median', bs[N / 2 | 0], 'p10', bs[N * 0.1 | 0], 'p90', bs[N * 0.9 | 0]);
  console.log('avg boss attempts', Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, (v / N).toFixed(2)])));
  console.log('typical levels when beaten', Object.fromEntries(Object.entries(lv).map(([k, v]) => [k, v[v.length >> 1]])));
}

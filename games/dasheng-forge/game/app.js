(function () {
  const $ = (s) => document.querySelector(s);
  const rng = Math.random;
  const SAVE = 'forge.save.v1';
  let S = null, tab = 'road', soundOn = true, busy = false;

  // ---------- 文字 ----------
  const L = {
    zh: {
      el: { metal: '金', wood: '木', water: '水', fire: '火', earth: '土' },
      grade: ['廢', '碎', '小', '中', '大', '極'],
      gemName: (el, g) => `${['', '碎', '小', '中', '大', '極'][g]}${L.zh.el[el]}晶`,
      gemEffect: { metal: (v) => `攻擊 +${v}`, water: (v) => `防禦 +${v}`, earth: (v) => `生命 +${v}`, fire: (v) => `爆擊 +${v}%`, wood: (v) => `每回合回血 ${v}` },
      mats: { bone: ['骨', '妖骨'], hide: ['皮', '妖皮'], core: ['丹', '妖丹'] },
      demons: { wind: '黑風小妖', yellow: '黃風怪', spider: '蜘蛛精', bone: '白骨精', gold: '金角大王', silver: '銀角大王', bear: '黑熊精', redboy: '紅孩兒', lion: '青獅精', elephant: '白象精', roc: '大鵬精', bull: '牛魔王' },
      places: ['黑風山', '黃風嶺', '盤絲洞', '白虎嶺', '蓮花洞', '壓龍山', '黑風洞', '火雲洞', '獅駝嶺', '獅駝洞', '獅駝城', '翠雲山'],
      equip: {
        weapon: ['赤手空拳', '鑌鐵棍', '混鐵棍', '如意金箍棒'],
        armor: ['粗布衣', '藤甲', '鎖子甲', '鎖子黃金甲'],
        crown: ['光頭', '虎皮頭巾', '金絲冠', '鳳翅紫金冠'],
      },
      slot: { weapon: '兵器', armor: '戰甲', crown: '頭冠' },
      stones: { rough: '粗石', mount: '山石', fairy: '仙石' },
      unlockAt: (n) => `打過第 ${n} 難開放`,
      lv: (l) => `大聖 Lv ${l}`, xpText: (a, b) => b ? `經驗 ${a} / ${b}` : `經驗 ${a}（已滿級）`,
      myStats: '大聖目前的能力', st: ['攻擊', '防禦', '生命', '爆擊', '回血'],
      cycleLabel: '五行相剋：', weaponEl: (e) => e ? `兵器屬性 ${e}` : '兵器沒有屬性：鑲上寶石就有',
      trial: (n) => `第 ${n} 難`, boss: '頭目', done: '已降伏',
      demonStat: (h, a, d) => `生命 ${h}　攻 ${a}　防 ${d}`,
      adv: '你剋它 傷害×1.5', dis: '它剋你 傷害×0.75', none: '無相剋',
      fight: '挑戰', refight: '再戰', refightSub: '收益減半', locked: '未到',
      tabRoad: '西行', tabStone: '賭石', tabForge: '煉器',
      stoneTitle: '賭石攤', stoneHelp: '外皮顏色多半透露屬性，光點越多通常等級越高，但不保證。擦窗要付一點錢，可以看到真屬性和等級範圍，還會有人出價收購。',
      tierSub: (p) => `每顆 ${p} 兩`,
      peekBtn: (c) => `擦窗 ${c} 兩`, cutBtn: (p) => `切開 ${p} 兩`, flipBtn: (n) => `轉手 ${n >= 0 ? '+' : ''}${n} 兩`,
      peekRange: (a, b) => `${a === b ? a : a + '～' + b}品`, offer: (n) => `收購價 ${n} 兩`,
      refresh: (c) => `換一批原石（${c} 兩）`, stallEmpty: '這一批都挑完了。打一場妖怪會免費進新貨，或花錢換一批。',
      waste: '廢石', wasteSub: '切開全是石頭，什麼也沒有。', gotGem: '切出寶石！', flipped: (n) => n >= 0 ? `轉手賺了 ${n} 兩` : `轉手虧了 ${-n} 兩`,
      ok: '好', close: '關閉',
      equipTitle: '裝備', equipHelp: '用妖怪掉的材料打造裝備。裝備越好，鑲嵌孔越多。點空孔鑲寶石，點寶石卸下。',
      craftBtn: '打造', upgradeBtn: '升級成', maxed: '已是最高等級', need: '需要',
      socketLocked: '升級裝備才有孔',
      gemTitle: '寶石袋', gemHelp: (r) => `三顆同屬性、同等級的寶石可以合成高一級。成功率：小 ${r[1]}%、中 ${r[2]}%、大 ${r[3]}%、極 ${r[4]}%。失敗只剩一顆。`,
      noGems: '還沒有寶石。去賭石攤切切看。',
      fuseBtn: (p) => `合成 ${p}%`, sellBtn: (p) => `賣 ${p}`, socketed: (n) => `鑲在裝備上 ${n} 顆`,
      fuseOk: '合成成功！', fuseFail: '合成失敗', fuseFailSub: '三顆寶石只剩一顆。',
      pickGem: '選一顆寶石鑲上去', noLoose: '沒有可以鑲的寶石。',
      battle: '戰鬥中', skip: '跳過動畫', win: '降妖成功', lose: '大聖敗退', loseSub: (n) => `被打回營地，丟了 ${n} 兩銀子。強化裝備或換寶石再來。`,
      reward: { silver: '銀兩', xp: '經驗', bone: '妖骨', hide: '妖皮', core: '妖丹' },
      levelUp: (n) => `升到 Lv ${n}！`, newStone: (s) => `新的原石開放：${s}`,
      allDone: '十二難全部過關，取經功德圓滿！可以繼續刷關，挑戰切出極品寶石。',
      resetBtn: '重新開始', resetQ: '確定要從頭開始嗎？目前的進度會清除。', resetYes: '清除重來', cancel: '取消',
      crit: '爆擊', round: (n) => `第 ${n} 回合`,
      soundOn: '音效 開', soundOff: '音效 關', langBtn: 'English',
    },
    en: {
      el: { metal: 'Metal', wood: 'Wood', water: 'Water', fire: 'Fire', earth: 'Earth' },
      grade: ['Waste', 'Chipped', 'Small', 'Medium', 'Large', 'Perfect'],
      gemName: (el, g) => `${['', 'Chipped', 'Small', 'Medium', 'Large', 'Perfect'][g]} ${L.en.el[el]} Gem`,
      gemEffect: { metal: (v) => `Attack +${v}`, water: (v) => `Defense +${v}`, earth: (v) => `HP +${v}`, fire: (v) => `Crit +${v}%`, wood: (v) => `Heal ${v} per round` },
      mats: { bone: ['Bone', 'Demon Bone'], hide: ['Hide', 'Demon Hide'], core: ['Core', 'Demon Core'] },
      demons: { wind: 'Black Wind Imp', yellow: 'Yellow Wind Fiend', spider: 'Spider Spirit', bone: 'White Bone Demon', gold: 'Golden Horn King', silver: 'Silver Horn King', bear: 'Black Bear Spirit', redboy: 'Red Boy', lion: 'Azure Lion', elephant: 'White Elephant', roc: 'Golden Roc', bull: 'Bull Demon King' },
      places: ['Black Wind Hill', 'Yellow Wind Ridge', 'Silk Cave', 'White Tiger Ridge', 'Lotus Cave', 'Dragon Hill', 'Black Wind Cave', 'Fire Cloud Cave', 'Lion Camel Ridge', 'Lion Camel Cave', 'Lion Camel City', 'Jade Cloud Mountain'],
      equip: {
        weapon: ['Bare Fists', 'Iron Staff', 'Steel Staff', 'Ruyi Golden Staff'],
        armor: ['Cloth Robe', 'Rattan Armor', 'Chain Mail', 'Golden Chain Mail'],
        crown: ['Bare Head', 'Tiger Headscarf', 'Gold-Thread Crown', 'Phoenix-Feather Crown'],
      },
      slot: { weapon: 'Weapon', armor: 'Armor', crown: 'Crown' },
      stones: { rough: 'Rough', mount: 'Mountain', fairy: 'Immortal' },
      unlockAt: (n) => `Unlocks after trial ${n}`,
      lv: (l) => `Monkey King Lv ${l}`, xpText: (a, b) => b ? `XP ${a} / ${b}` : `XP ${a} (max level)`,
      myStats: 'YOUR STATS', st: ['ATK', 'DEF', 'HP', 'Crit', 'Regen'],
      cycleLabel: 'Elements:', weaponEl: (e) => e ? `Weapon element: ${e}` : 'Weapon has no element. Socket a gem to add one.',
      trial: (n) => `TRIAL ${n}`, boss: 'BOSS', done: 'Beaten',
      demonStat: (h, a, d) => `HP ${h} · ATK ${a} · DEF ${d}`,
      adv: 'You counter it ×1.5', dis: 'It counters you ×0.75', none: 'Neutral',
      fight: 'Fight', refight: 'Refight', refightSub: 'Half rewards', locked: 'Locked',
      tabRoad: 'Journey', tabStone: 'Stones', tabForge: 'Forge',
      stoneTitle: 'Stone Stall', stoneHelp: "The skin's color usually hints at the element, and more sparkles usually mean a better gem, but nothing is certain. Pay to polish a window and you see the true element and grade range, plus a buyer's offer.",
      tierSub: (p) => `${p} silver each`,
      peekBtn: (c) => `Polish ${c}`, cutBtn: (p) => `Cut ${p}`, flipBtn: (n) => `Flip ${n >= 0 ? '+' : ''}${n}`,
      peekRange: (a, b) => a === b ? a : `${a} to ${b}`, offer: (n) => `Offer: ${n} silver`,
      refresh: (c) => `New stones (${c} silver)`, stallEmpty: 'All picked over. Winning a fight restocks for free, or pay for a new batch.',
      waste: 'Just rock', wasteSub: 'Nothing inside but stone.', gotGem: 'A gem!', flipped: (n) => n >= 0 ? `Flipped for a ${n} silver profit` : `Flipped at a ${-n} silver loss`,
      ok: 'OK', close: 'Close',
      equipTitle: 'Equipment', equipHelp: 'Craft gear from demon materials. Better gear has more gem sockets. Tap an empty socket to insert a gem, tap a gem to remove it.',
      craftBtn: 'Craft', upgradeBtn: 'Upgrade to', maxed: 'Fully upgraded', need: 'Needs',
      socketLocked: 'Upgrade for more sockets',
      gemTitle: 'Gem Pouch', gemHelp: (r) => `Fuse three gems of the same element and grade into the next grade. Success: Small ${r[1]}%, Medium ${r[2]}%, Large ${r[3]}%, Perfect ${r[4]}%. On failure only one gem is left.`,
      noGems: 'No gems yet. Try cutting some stones.',
      fuseBtn: (p) => `Fuse ${p}%`, sellBtn: (p) => `Sell ${p}`, socketed: (n) => `${n} socketed`,
      fuseOk: 'Fusion succeeded!', fuseFail: 'Fusion failed', fuseFailSub: 'Only one of the three gems is left.',
      pickGem: 'Pick a gem to socket', noLoose: 'No free gems to socket.',
      battle: 'Fighting', skip: 'Skip', win: 'Demon defeated', lose: 'Defeated', loseSub: (n) => `Knocked back to camp. You dropped ${n} silver. Upgrade your gear or swap gems and try again.`,
      reward: { silver: 'Silver', xp: 'XP', bone: 'Demon Bone', hide: 'Demon Hide', core: 'Demon Core' },
      levelUp: (n) => `Level ${n}!`, newStone: (s) => `New stones unlocked: ${s}`,
      allDone: 'All twelve trials cleared. The journey is complete! Keep farming and chase a Perfect gem.',
      resetBtn: 'Restart', resetQ: 'Start over from the beginning? Your progress will be erased.', resetYes: 'Erase and restart', cancel: 'Cancel',
      crit: 'CRIT', round: (n) => `Round ${n}`,
      soundOn: 'Sound on', soundOff: 'Sound off', langBtn: '中文',
    },
  };
  let lang = (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  try { lang = localStorage.getItem('forge.lang') || lang; } catch (e) {}
  const t = (k, ...a) => { const v = L[lang][k]; return typeof v === 'function' ? v(...a) : v; };
  const elName = (e) => L[lang].el[e];
  const ELCH = { metal: '金', wood: '木', water: '水', fire: '火', earth: '土' };
  const elBadge = (e, cls = '') => `<span class="el el-${e} ${cls}" lang="zh-Hant" title="${elName(e)}">${ELCH[e]}</span>`;
  const DEMON_GLYPH = { wind: '風', yellow: '黃', spider: '蛛', bone: '骨', gold: '金', silver: '銀', bear: '熊', redboy: '火', lion: '獅', elephant: '象', roc: '鵬', bull: '牛' };
  const EL_COLOR = { metal: '#f0dc8a', wood: '#6fd08c', water: '#5aa9ff', fire: '#ff7a45', earth: '#d19a5c' };

  // ---------- 美術素材：game/assets/manifest.js 列出的檔案會取代內建圖形 ----------
  const ASSETS = new Set(window.ASSET_FILES || []);
  const hasArt = (k) => ASSETS.has(k);
  const artImg = (k, cls = '') => `<img class="art ${cls}" src="assets/${k}.png" alt="" draggable="false">`;
  // 放進圓框時臉要在中間：各圖臉部的位置（水平%, 垂直%）與放大倍率，沒列的用預設
  const FOCUS = { wukong: [56, 40, 1.45], demon_bone: [44, 36, 1.7] };
  const cropImg = (k, cls) => {
    const [fx, fy, z] = FOCUS[k] || [50, 40, 1.4];
    return `<span class="crop ${cls}"><img class="art" src="assets/${k}.png" alt="" draggable="false" style="transform-origin:${fx}% ${fy}%;transform:scale(${z})"></span>`;
  };
  const art = (k, fallback, cls = '') => !hasArt(k) ? fallback : cls === 'demon' ? cropImg(k, 'demon') : artImg(k, cls);
  ['ch1', 'stall', 'forge'].forEach(k => { if (hasArt('bg_' + k)) document.documentElement.style.setProperty('--bg-' + k, `url(assets/bg_${k}.png)`); });

  // ---------- 圖形 ----------
  let gid = 0;
  function gemSVG(el, g) {
    if (hasArt(`gem_${el}_${g}`)) return `<span class="gem-art">${artImg(`gem_${el}_${g}`, 'gem')}<span class="pips" style="color:${EL_COLOR[el]}">${'●'.repeat(g)}</span></span>`;
    const c = EL_COLOR[el], id = 'gm' + (++gid);
    const r = 20 + g * 3.2;
    const pts = [[50, 50 - r], [50 + r * .87, 50 - r * .5], [50 + r * .87, 50 + r * .5], [50, 50 + r], [50 - r * .87, 50 + r * .5], [50 - r * .87, 50 - r * .5]];
    const P = pts.map(p => p.join(',')).join(' ');
    const inner = pts.map(p => [50 + (p[0] - 50) * .5, 50 + (p[1] - 50) * .5]);
    const facets = pts.map((p, i) => { const q = pts[(i + 1) % 6], a = inner[i], b = inner[(i + 1) % 6]; return `<polygon points="${p.join(',')} ${q.join(',')} ${b.join(',')} ${a.join(',')}" fill="#fff" opacity="${[.28, .12, 0, .05, .18, .35][i]}"/>`; }).join('');
    const pips = Array.from({ length: g }, (_, i) => `<circle cx="${50 - (g - 1) * 5 + i * 10}" cy="93" r="3.2" fill="${c}" stroke="#0c1613" stroke-width="1"/>`).join('');
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${id}" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".35" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".55"/></radialGradient></defs>
      ${g >= 4 ? `<circle cx="50" cy="50" r="${r + 9}" fill="${c}" opacity=".18"/>` : ''}
      <polygon points="${P}" fill="url(#${id})" stroke="${c}" stroke-width="2"/>
      ${facets}<polygon points="${inner.map(p => p.join(',')).join(' ')}" fill="#fff" opacity=".15"/>${pips}</svg>`;
  }
  const ROCKS = [
    'M18 62 L22 34 L40 18 L66 16 L84 30 L90 56 L78 80 L48 86 L26 80 Z',
    'M14 56 L26 28 L52 20 L76 26 L88 48 L84 72 L60 86 L32 84 Z',
    'M20 70 L16 44 L34 22 L60 18 L80 30 L88 60 L72 82 L40 86 Z',
    'M16 60 L28 30 L48 24 L70 20 L86 40 L84 70 L62 84 L30 82 Z',
  ];
  function stoneSVG(st) {
    const id = 'st' + (++gid), c = EL_COLOR[st.tint];
    const sparks = [[38, 40], [62, 36], [54, 60]].slice(0, st.sheen).map(([x, y]) => `<path d="M${x} ${y - 6} L${x + 1.6} ${y - 1.6} L${x + 6} ${y} L${x + 1.6} ${y + 1.6} L${x} ${y + 6} L${x - 1.6} ${y + 1.6} L${x - 6} ${y} L${x - 1.6} ${y - 1.6} Z" fill="#fff8d0" opacity=".95"/>`).join('');
    const win = st.peeked ? `<ellipse cx="50" cy="54" rx="14" ry="10" fill="${EL_COLOR[st.el]}" stroke="#0c1613" stroke-width="2"/><ellipse cx="46" cy="51" rx="5" ry="3" fill="#fff" opacity=".5"/>` : '';
    const key = 'stone_' + STONES[st.tier].key;
    if (hasArt(key)) return `<div class="stone-art">${artImg(key)}<svg viewBox="0 0 100 100" aria-hidden="true">${win}${sparks}</svg></div>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${id}" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#9a958c"/><stop offset=".6" stop-color="#5b5750"/><stop offset="1" stop-color="#34312c"/></radialGradient></defs>
      <path d="${ROCKS[st.shape]}" fill="url(#${id})" stroke="#1d1b18" stroke-width="2"/>
      <path d="${ROCKS[st.shape]}" fill="${c}" opacity=".26"/>
      <path d="M30 40 Q 44 46 52 38 M60 64 Q 66 56 76 60" stroke="#2a2723" stroke-width="1.5" fill="none" opacity=".7"/>
      ${win}${sparks}</svg>`;
  }
  function portrait(el) {
    if (hasArt('wukong')) { el.outerHTML = cropImg('wukong', 'portrait-art').replace('<span class="crop', `<span id="${el.id}" class="crop`); return; }
    el.innerHTML = `<circle cx="60" cy="64" r="44" fill="#8a4a22"/><circle cx="22" cy="66" r="12" fill="#8a4a22"/><circle cx="98" cy="66" r="12" fill="#8a4a22"/>
      <circle cx="22" cy="66" r="6" fill="#f0b77a"/><circle cx="98" cy="66" r="6" fill="#f0b77a"/>
      <path d="M30 70 C 30 46, 50 40, 60 52 C 70 40, 90 46, 90 70 C 90 92, 76 104, 60 104 C 44 104, 30 92, 30 70 Z" fill="#e9b47a"/>
      <path d="M22 44 C 40 28, 80 28, 98 44" fill="none" stroke="#e4b64a" stroke-width="7" stroke-linecap="round"/><circle cx="60" cy="33" r="5" fill="#ffe08a" stroke="#b8861f" stroke-width="2"/>
      <ellipse cx="47" cy="66" rx="7" ry="6" fill="#fff4d0"/><ellipse cx="73" cy="66" rx="7" ry="6" fill="#fff4d0"/>
      <circle cx="48" cy="66" r="3.4" fill="#ff5a2a"/><circle cx="72" cy="66" r="3.4" fill="#ff5a2a"/>
      <path d="M52 86 Q 60 92 68 86" fill="none" stroke="#6b3518" stroke-width="3" stroke-linecap="round"/>
      <circle cx="55" cy="79" r="1.8" fill="#6b3518"/><circle cx="65" cy="79" r="1.8" fill="#6b3518"/>`;
  }
  portrait($('#portrait'));

  // ---------- 音效 ----------
  let ac = null;
  function audio() { if (!soundOn) return null; try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); return ac; } catch (e) { return null; } }
  function tone(freqs, dur, vol = .14, type = 'sine', delay = 0) {
    const a = audio(); if (!a) return; const at = a.currentTime + delay;
    freqs.forEach((f, i) => { const o = a.createOscillator(); o.type = type; o.frequency.value = f; const g = a.createGain(); g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(vol / (i + 1), at + .015); g.gain.exponentialRampToValueAtTime(.0001, at + dur); o.connect(g).connect(a.destination); o.start(at); o.stop(at + dur + .05); });
  }
  function noise(dur, freq, vol = .6, delay = 0) {
    const a = audio(); if (!a) return; const at = a.currentTime + delay;
    const buf = a.createBuffer(1, Math.max(1, a.sampleRate * dur), a.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = a.createBufferSource(); src.buffer = buf; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.5;
    const g = a.createGain(); g.gain.value = vol; src.connect(f).connect(g).connect(a.destination); src.start(at);
  }
  const sfx = {
    cut() { noise(.25, 3000, .5); noise(.15, 800, .6, .3); },
    gem(g) { tone([523, 659, 784, 1047].slice(0, Math.min(4, g + 1)), .9, .14, 'triangle'); },
    waste() { noise(.3, 300, .7); tone([147, 131], .5, .1, 'triangle'); },
    hit(c) { noise(.08, c ? 1400 : 700, .7); },
    hurt() { noise(.1, 260, .7); },
    win() { tone([392, 523, 659, 784], 1.2, .14, 'triangle'); },
    lose() { tone([196, 165, 131], 1.2, .12, 'triangle'); },
    coin() { tone([988, 1319], .25, .08, 'triangle'); },
    forge() { noise(.06, 2500, .7); noise(.06, 2500, .6, .18); tone([440, 660], .6, .1, 'triangle', .3); },
  };

  // ---------- 存檔 ----------
  const P = window.platform || null; // Steam 桌面版由 electron/preload.js 提供
  function save() {
    checkAch();
    const json = JSON.stringify(S);
    if (P && P.writeSave) { P.writeSave(json); return; }
    try { localStorage.setItem(SAVE, json); } catch (e) {}
  }
  function parseSave(txt) { try { const d = JSON.parse(txt || 'null'); if (d && d.equip && d.mats) return d; } catch (e) {} return null; }
  function load() { try { return parseSave(localStorage.getItem(SAVE)); } catch (e) { return null; } }
  function fresh() { const s = newGame(); refreshStall(s, rng, true); return s; }

  // ---------- 成就：ID 要和 Steamworks 後台設定的一樣（steam/achievements.md） ----------
  const ACH = [
    ['FIRST_WIN', s => s.stats.wins >= 1],
    ['FIRST_GEM', s => s.stats.bestGem >= 1],
    ['GEM_LARGE', s => s.stats.bestGem >= 4],
    ['GEM_PERFECT', s => s.stats.bestGem >= 5],
    ['FUSE_FAIL_3', s => s.stats.fuseFails >= 3],
    ['FLIP_500', s => (s.stats.flipProfit || 0) >= 500],
    ['BEAT_BONE', s => s.cleared >= 4],
    ['BEAT_REDBOY', s => s.cleared >= 8],
    ['BEAT_BULL', s => s.cleared >= 12],
    ['RUYI_STAFF', s => s.equip.weapon.tier >= 3],
    ['FULL_SET', s => s.equip.weapon.tier >= 3 && s.equip.armor.tier >= 3 && s.equip.crown.tier >= 3],
    ['COUNTER_BOSS', s => !!s.stats.counterBoss],
  ];
  const ACH_NAME = {
    zh: { FIRST_WIN: '初次降妖', FIRST_GEM: '石中有寶', GEM_LARGE: '大品到手', GEM_PERFECT: '極品現世', FUSE_FAIL_3: '火候未到', FLIP_500: '轉手高手', BEAT_BONE: '三打白骨精', BEAT_REDBOY: '滅了三昧火', BEAT_BULL: '取經功德圓滿', RUYI_STAFF: '如意金箍棒', FULL_SET: '齊天大聖全套', COUNTER_BOSS: '五行相剋' },
    en: { FIRST_WIN: 'First Demon Down', FIRST_GEM: 'Something Inside', GEM_LARGE: 'A Large One', GEM_PERFECT: 'Perfect Gem', FUSE_FAIL_3: 'Not Hot Enough', FLIP_500: 'Stone Trader', BEAT_BONE: 'White Bone Defeated', BEAT_REDBOY: 'Fire Put Out', BEAT_BULL: 'Journey Complete', RUYI_STAFF: 'Ruyi Golden Staff', FULL_SET: 'Great Sage Equipped', COUNTER_BOSS: 'Elemental Counter' },
  };
  function checkAch() {
    if (!S) return;
    S.ach = S.ach || [];
    for (const [id, test] of ACH) {
      if (S.ach.includes(id) || !test(S)) continue;
      S.ach.push(id);
      if (P && P.unlock) P.unlock(id);
      setTimeout(() => toast(`<b>${lang === 'en' ? 'Achievement' : '成就'}</b>　${ACH_NAME[lang][id]}`), 900);
    }
  }

  // ---------- 共用 ----------
  let toastTimer;
  function toast(html) { const el = $('#toast'); el.innerHTML = html; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3000); }
  function openModal(html) { $('#modal-body').innerHTML = html; $('#modal').hidden = false; const f = $('#modal-body button'); if (f) f.focus(); }
  function closeModal() { $('#modal').hidden = true; }
  const matIco = (m) => `<span class="mat-ico" lang="zh-Hant" title="${L[lang].mats[m][1]}">${art('mat_' + m, L.zh.mats[m][0], 'mat')}</span>`;
  function costHTML(cost) {
    return Object.keys(cost).map(k => {
      const have = k === 'silver' ? S.silver : S.mats[k];
      const ico = k === 'silver' ? '<i class="ingot" style="width:14px;height:10px"></i>' : matIco(k);
      return `<span class="num ${have < cost[k] ? 'lack' : ''}" style="display:inline-flex;gap:3px;align-items:center">${ico}${cost[k]}</span>`;
    }).join('');
  }
  function matchup(me, d) {
    const m = elementMult(me, d);
    return m > 1 ? `<span class="match adv">${t('adv')}</span>` : m < 1 ? `<span class="match dis">${t('dis')}</span>` : `<span class="match none">${t('none')}</span>`;
  }

  // ---------- 頂端 ----------
  function renderHud() {
    $('#hud-lv').textContent = t('lv', S.level);
    const lo = LEVEL_XP[S.level - 1] || 0, hi = LEVEL_XP[S.level];
    $('#hud-xp').style.width = hi ? ((S.xp - lo) / (hi - lo) * 100) + '%' : '100%';
    $('#hud-xptext').textContent = t('xpText', S.xp, hi);
    $('#hud-silver').textContent = S.silver;
    $('#hud-mats').innerHTML = ['bone', 'hide', 'core'].map(m => `<span>${matIco(m)}${S.mats[m]}</span>`).join('');
    // 分頁提示點
    $('#dot-forge').hidden = !(['weapon', 'armor', 'crown'].some(k => canCraft(S, k)) || hasFuse() || hasOpenSocket());
    $('#dot-stone').hidden = !(S.stall.length && S.silver >= STONES[S.stallTier].price);
    $('#dot-road').hidden = true;
  }
  function hasFuse() { for (const el of ELEMENTS) for (let g = 1; g < 5; g++) if (looseGems(S, el, g).length >= 3) return true; return false; }
  function hasOpenSocket() {
    const loose = S.gems.some(x => !isSocketed(S, x.id));
    return loose && ['weapon', 'armor', 'crown'].some(k => S.equip[k].sockets.length < (EQUIP[k][S.equip[k].tier].sockets || 0));
  }

  // ---------- 西行 ----------
  function renderRoad() {
    const st = stats(S);
    $('#statline').innerHTML = [st.atk, st.def, st.hp, st.crit + '%', st.regen].map((v, i) => `<div class="stat"><b>${v}</b><span>${t('st')[i]}</span></div>`).join('');
    const order = ['metal', 'wood', 'earth', 'water', 'fire'];
    $('#cycle').innerHTML = `<span>${t('cycleLabel')}</span>` + order.map(e => elBadge(e)).join('<span>→</span>') + '<span>→</span>' + elBadge('metal')
      + `<span style="flex-basis:100%;height:0"></span><span>${t('weaponEl', st.el ? elName(st.el) : '')}</span>${st.el ? elBadge(st.el) : ''}`;
    $('#route').innerHTML = DEMONS.map((d, i) => {
      const done = i < S.cleared, next = i === S.cleared, locked = i > S.cleared;
      let btn = '';
      if (next) btn = `<button class="btn gold" data-fight="${i}">${t('fight')}</button>`;
      else if (done) btn = `<button class="btn ghost" data-fight="${i}">${t('refight')}<small>${t('refightSub')}</small></button>`;
      else btn = `<span class="muted">${t('locked')}</span>`;
      return `<div class="stage ${next ? 'next' : ''} ${locked ? 'locked' : ''}">
        <div class="seal ${d.boss ? 'boss' : ''}" lang="zh-Hant">${art('demon_' + d.key, DEMON_GLYPH[d.key], 'demon')}${elBadge(d.el)}</div>
        <div style="min-width:0"><div class="eyebrow">${t('trial', i + 1)}・${L[lang].places[i]}</div>
          <div class="name"><h3>${L[lang].demons[d.key]}</h3>${d.boss ? `<span class="tag boss">${t('boss')}</span>` : ''}${done ? `<span class="tag done">${t('done')}</span>` : ''}</div>
          <div class="meta num"><span>${t('demonStat', d.hp, d.atk, d.def)}</span>${locked ? '' : matchup(st.el, d.el)}</div></div>
        ${btn}</div>`;
    }).join('');
  }
  $('#route').addEventListener('click', (e) => { const b = e.target.closest('[data-fight]'); if (b) startFight(+b.dataset.fight); });

  // ---------- 戰鬥 ----------
  let skipFight = null;
  function startFight(i) {
    if (busy) return; busy = true;
    const d = DEMONS[i], me = stats(S);
    const unlockedBefore = STONES.map((_, k) => stoneUnlocked(S, k));
    const res = fight(S, i, rng);
    if (res.win && d.boss && res.mult > 1) S.stats.counterBoss = true;
    save();
    openModal(`<div class="eyebrow">${t('trial', i + 1)}・${L[lang].places[i]}　${matchup(me.el, d.el)}</div>
      <div class="vs">
        <div class="fighter" id="f-me"><svg viewBox="0 0 120 120" id="f-portrait"></svg><div class="nm">${t('lv', S.level - (res.levelUp || 0))}</div><div class="hpbar"><i id="hp-me" style="width:100%"></i></div><div class="hpt num" id="hpt-me">${res.maxHp}</div></div>
        <div class="mid">VS</div>
        <div class="fighter" id="f-foe"><div class="seal ${d.boss ? 'boss' : ''}" lang="zh-Hant">${art('demon_' + d.key, DEMON_GLYPH[d.key], 'demon')}${elBadge(d.el)}</div><div class="nm">${L[lang].demons[d.key]}</div><div class="hpbar"><i id="hp-foe" style="width:100%"></i></div><div class="hpt num" id="hpt-foe">${res.dmax}</div></div>
      </div>
      <div class="muted num" id="f-round" style="text-align:center">${t('battle')}</div>
      <div id="f-result"></div>
      <button class="btn ghost" id="btn-skip">${t('skip')}</button>`);
    portrait($('#f-portrait'));
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let k = 0, timer = null;
    const float = (host, txt, color) => { const el = document.createElement('div'); el.className = 'float'; el.textContent = txt; el.style.color = color; host.appendChild(el); setTimeout(() => el.remove(), 750); };
    const step = () => {
      const e = res.log[k];
      $('#f-round').textContent = t('round', e.r);
      $('#hp-foe').style.width = (e.dhp / res.dmax * 100) + '%'; $('#hpt-foe').textContent = e.dhp;
      float($('#f-foe'), (e.crit ? t('crit') + ' ' : '') + '−' + e.dmg, e.crit ? 'var(--gold-hi)' : '#fff'); sfx.hit(e.crit);
      $('#f-foe').classList.remove('shake'); void $('#f-foe').offsetWidth; $('#f-foe').classList.add('shake');
      if (e.taken) setTimeout(() => {
        $('#hp-me').style.width = (e.hp / res.maxHp * 100) + '%'; $('#hpt-me').textContent = e.hp;
        float($('#f-me'), '−' + e.taken, 'var(--red)'); sfx.hurt();
        if (e.heal) setTimeout(() => float($('#f-me'), '+' + e.heal, 'var(--jade)'), 120);
      }, 130);
      k++;
      if (k >= res.log.length) { clearInterval(timer); setTimeout(finish, 350); }
    };
    const finish = () => {
      if (skipFight === null) return; skipFight = null;
      const last = res.log[res.log.length - 1];
      $('#hp-foe').style.width = (last.dhp / res.dmax * 100) + '%'; $('#hpt-foe').textContent = last.dhp;
      $('#hp-me').style.width = (last.hp / res.maxHp * 100) + '%'; $('#hpt-me').textContent = last.hp;
      $('#btn-skip').remove();
      let html;
      if (res.win) {
        sfx.win();
        const lines = [[t('reward').silver, `+${res.silver}`], [t('reward').xp, `+${res.xp}`]].concat(Object.keys(res.drop).map(m => [t('reward')[m], `+${res.drop[m]}`]));
        const unlocked = STONES.map((_, j) => stoneUnlocked(S, j)).map((u, j) => u && !unlockedBefore[j] ? L[lang].stones[STONES[j].key] : null).filter(Boolean);
        html = `<h2>${t('win')}</h2><div class="lines num">${lines.map(l => `<div><span>${l[0]}</span><span>${l[1]}</span></div>`).join('')}</div>`
          + (res.levelUp ? `<h3 style="color:var(--jade)">${t('levelUp', S.level)}</h3>` : '')
          + (unlocked.length ? `<div class="muted" style="color:var(--gold-hi)">${t('newStone', unlocked.join('、'))}</div>` : '')
          + (res.done && res.first ? `<div class="panel" style="color:var(--gold-hi)">${t('allDone')}</div>` : '');
      } else {
        sfx.lose();
        html = `<h2 style="color:var(--red)">${t('lose')}</h2><p class="muted" style="margin:0">${t('loseSub', res.lost)}</p>`;
      }
      $('#f-result').innerHTML = html + `<button class="btn gold" id="btn-close" style="width:100%;margin-top:10px">${t('ok')}</button>`;
      $('#btn-close').focus();
      busy = false;
      renderAll();
    };
    skipFight = () => { clearInterval(timer); finish(); };
    if (reduce) { skipFight(); return; }
    timer = setInterval(step, 260);
  }

  // ---------- 賭石 ----------
  function renderStone() {
    $('#tiers').innerHTML = STONES.map((s, i) => {
      const un = stoneUnlocked(S, i);
      return `<button class="tierbtn" data-tier="${i}" aria-pressed="${S.stallTier === i}" ${un ? '' : 'disabled'}><b>${L[lang].stones[s.key]}</b><span class="num">${un ? t('tierSub', s.price) : t('unlockAt', s.unlock)}</span></button>`;
    }).join('');
    $('#stall').innerHTML = S.stall.length ? S.stall.map(st => {
      const price = buyCost(st), pc = peekCost(st);
      let peekInfo = '';
      if (st.peeked) {
        const g = L[lang].grade;
        peekInfo = `<span style="display:flex;gap:4px;align-items:center">${elBadge(st.el)}<b>${t('peekRange', g[st.range[0]], g[st.range[1]])}</b></span><span class="num">${t('offer', st.offer)}</span>`;
      }
      return `<div class="stone-card" data-stone="${st.id}">${stoneSVG(st)}<div class="price num">${price}</div><div class="peek">${peekInfo}</div>
        <div class="acts">
          ${st.peeked ? `<button class="btn ghost" data-flip="${st.id}" ${S.silver < price ? 'disabled' : ''}>${t('flipBtn', st.offer - price)}</button>`
            : `<button class="btn ghost" data-peek="${st.id}" ${S.silver < pc ? 'disabled' : ''}>${t('peekBtn', pc)}</button>`}
          <button class="btn gold" data-cut="${st.id}" ${S.silver < price ? 'disabled' : ''}>${t('cutBtn', price)}</button>
        </div></div>`;
    }).join('') : `<div class="empty-stall">${t('stallEmpty')}</div>`;
    const rc = refreshCost(S);
    $('#btn-refresh').textContent = t('refresh', rc);
    $('#btn-refresh').disabled = S.silver < rc;
  }
  $('#tiers').addEventListener('click', (e) => { const b = e.target.closest('[data-tier]'); if (b && setStallTier(S, +b.dataset.tier, rng)) { save(); renderAll(); } });
  $('#btn-refresh').addEventListener('click', () => { if (refreshStall(S, rng, false)) { sfx.coin(); save(); renderAll(); } });
  $('#stall').addEventListener('click', (e) => {
    if (busy) return;
    const p = e.target.closest('[data-peek]'), c = e.target.closest('[data-cut]'), f = e.target.closest('[data-flip]');
    if (p) { if (peek(S, +p.dataset.peek, rng)) { noise(.4, 4000, .25); save(); renderAll(); } return; }
    if (f) {
      const r = flipStone(S, +f.dataset.flip);
      if (r) { sfx.coin(); toast(t('flipped', r.profit)); save(); renderAll(); }
      return;
    }
    if (c) {
      const id = +c.dataset.cut;
      const card = c.closest('.stone-card');
      const st = S.stall.find(x => x.id === id);
      if (!st || S.silver < buyCost(st)) return;
      busy = true; sfx.cut();
      card.classList.add('cutting');
      setTimeout(() => {
        const r = cutStone(S, id);
        save();
        busy = false;
        if (!r) { renderAll(); return; }
        if (r.gem) {
          sfx.gem(r.gem.g);
          openModal(`<div class="reveal"><div class="eyebrow">${t('gotGem')}</div><div class="${r.gem.g >= 3 ? 'rays' : ''}">${gemSVG(r.gem.el, r.gem.g)}</div>
            <div class="big" style="color:${EL_COLOR[r.gem.el]}">${L[lang].gemName(r.gem.el, r.gem.g)}</div>
            <div class="muted">${L[lang].gemEffect[r.gem.el](GEM_STAT[r.gem.el][r.gem.g])}</div></div><button class="btn gold" id="btn-close">${t('ok')}</button>`);
        } else {
          sfx.waste();
          openModal(`<div class="reveal"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M20 60 L30 40 L46 46 L52 30 L70 38 L82 60 L64 78 L36 78 Z" fill="#4e4a44" stroke="#1d1b18" stroke-width="2"/><path d="M46 46 L50 62 L64 78 M50 62 L36 78" stroke="#1d1b18" stroke-width="2" fill="none"/></svg>
            <div class="big" style="color:var(--muted)">${t('waste')}</div><div class="muted">${t('wasteSub')}</div></div><button class="btn gold" id="btn-close">${t('ok')}</button>`);
        }
        renderAll();
      }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 30 : 560);
    }
  });

  // ---------- 煉器 ----------
  function renderForge() {
    $('#equip').innerHTML = ['weapon', 'armor', 'crown'].map(k => {
      const e = S.equip[k], cur = EQUIP[k][e.tier], next = EQUIP[k][e.tier + 1];
      const statTxt = k === 'weapon' ? `${t('st')[0]} +${cur.atk}` : k === 'armor' ? `${t('st')[1]} +${cur.def}・${t('st')[2]} +${cur.hp}` : `${t('st')[3]} +${cur.crit}%`;
      const cap = cur.sockets || 0, maxCap = 3;
      let sockets = '';
      for (let i = 0; i < maxCap; i++) {
        const gidv = e.sockets[i];
        if (gidv != null) { const gm = S.gems.find(x => x.id === gidv); sockets += `<button class="socket filled" data-unsock="${k}:${gidv}" aria-label="${L[lang].gemName(gm.el, gm.g)}">${gemSVG(gm.el, gm.g)}</button>`; }
        else if (i < cap) sockets += `<button class="socket" data-sock="${k}" aria-label="+"><span class="plus">+</span></button>`;
        else sockets += `<span class="socket locked" title="${t('socketLocked')}"></span>`;
      }
      const craftBtn = next ? `<div style="display:grid;gap:6px"><div class="cost">${t('need')}：${costHTML(next.cost)}</div>
        <button class="btn ${canCraft(S, k) ? 'gold' : ''}" data-craft="${k}" ${canCraft(S, k) ? '' : 'disabled'}>${e.tier === 0 ? t('craftBtn') : t('upgradeBtn')} ${L[lang].equip[k][e.tier + 1]}</button></div>`
        : `<div class="muted">${t('maxed')}</div>`;
      const icon = e.tier > 0 && hasArt(`${k}_${e.tier}`) ? artImg(`${k}_${e.tier}`, 'eq-icon') : '';
      return `<div class="panel eq"><div class="eq-top">${icon}<div style="flex:1;min-width:0"><div class="eyebrow">${L[lang].slot[k]}</div><h3>${L[lang].equip[k][e.tier]}</h3></div><span class="tier num">${statTxt}</span></div>
        <div class="sockets">${sockets}</div>${craftBtn}</div>`;
    }).join('');
    const groups = [];
    for (const el of ELEMENTS) for (let g = 5; g >= 1; g--) {
      const all = S.gems.filter(x => x.el === el && x.g === g);
      if (!all.length) continue;
      groups.push({ el, g, all, loose: all.filter(x => !isSocketed(S, x.id)) });
    }
    groups.sort((a, b) => b.g - a.g);
    $('#gems').innerHTML = groups.length ? groups.map(gr => {
      const sock = gr.all.length - gr.loose.length;
      const canF = gr.g < 5 && gr.loose.length >= 3;
      return `<div class="gemrow">${gemSVG(gr.el, gr.g)}<div class="info" style="min-width:0"><b style="color:${EL_COLOR[gr.el]}">${L[lang].gemName(gr.el, gr.g)} ×${gr.all.length}</b>
        <div>${L[lang].gemEffect[gr.el](GEM_STAT[gr.el][gr.g])}${sock ? '・' + t('socketed', sock) : ''}</div></div>
        <div class="acts">${gr.g < 5 ? `<button class="btn ${canF ? 'gold' : 'ghost'}" data-fuse="${gr.el}:${gr.g}" ${canF ? '' : 'disabled'}>${t('fuseBtn', Math.round(FUSE_RATE[gr.g] * 100))}</button>` : ''}
        <button class="btn ghost" data-sell="${gr.el}:${gr.g}" ${gr.loose.length ? '' : 'disabled'}>${t('sellBtn', GEM_PRICE[gr.g])}</button></div></div>`;
    }).join('') : `<div class="panel muted">${t('noGems')}</div>`;
  }
  $('#tab-forge').addEventListener('click', (e) => {
    if (busy) return;
    const cr = e.target.closest('[data-craft]'), so = e.target.closest('[data-sock]'), un = e.target.closest('[data-unsock]'), fu = e.target.closest('[data-fuse]'), se = e.target.closest('[data-sell]');
    if (cr) { if (craft(S, cr.dataset.craft)) { sfx.forge(); toast(`<b>${L[lang].equip[cr.dataset.craft][S.equip[cr.dataset.craft].tier]}</b>`); save(); renderAll(); } }
    else if (un) { const [k, id] = un.dataset.unsock.split(':'); unsocket(S, k, +id); save(); renderAll(); }
    else if (so) {
      const k = so.dataset.sock;
      const loose = S.gems.filter(x => !isSocketed(S, x.id)).sort((a, b) => b.g - a.g);
      openModal(`<h2>${t('pickGem')}・${L[lang].slot[k]}</h2>` + (loose.length ? `<div class="pick">${loose.map(gm => `<button data-pick="${k}:${gm.id}">${gemSVG(gm.el, gm.g)}<span><b style="color:${EL_COLOR[gm.el]}">${L[lang].gemName(gm.el, gm.g)}</b><br><span class="muted">${L[lang].gemEffect[gm.el](GEM_STAT[gm.el][gm.g])}</span></span></button>`).join('')}</div>` : `<p class="muted">${t('noLoose')}</p>`)
        + `<button class="btn ghost" id="btn-close">${t('close')}</button>`);
    }
    else if (fu) {
      const [el, g] = fu.dataset.fuse.split(':');
      busy = true; noise(.5, 1800, .3);
      setTimeout(() => {
        const r = fuse(S, el, +g, rng); save(); busy = false;
        if (!r) { renderAll(); return; }
        if (r.ok) { sfx.gem(r.gem.g); openModal(`<div class="reveal"><div class="eyebrow">${t('fuseOk')}</div><div class="rays">${gemSVG(r.gem.el, r.gem.g)}</div><div class="big" style="color:${EL_COLOR[r.gem.el]}">${L[lang].gemName(r.gem.el, r.gem.g)}</div><div class="muted">${L[lang].gemEffect[r.gem.el](GEM_STAT[r.gem.el][r.gem.g])}</div></div><button class="btn gold" id="btn-close">${t('ok')}</button>`); }
        else { sfx.waste(); openModal(`<div class="reveal"><div class="big" style="color:var(--red)">${t('fuseFail')}</div>${gemSVG(r.gem.el, r.gem.g)}<div class="muted">${t('fuseFailSub')}</div></div><button class="btn gold" id="btn-close">${t('ok')}</button>`); }
        renderAll();
      }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 30 : 600);
    }
    else if (se) {
      const [el, g] = se.dataset.sell.split(':');
      const gm = looseGems(S, el, +g)[0];
      if (gm) { sellGem(S, gm.id); sfx.coin(); save(); renderAll(); }
    }
  });

  // ---------- 對話框 ----------
  $('#modal').addEventListener('click', (e) => {
    const pk = e.target.closest('[data-pick]');
    if (pk) { const [k, id] = pk.dataset.pick.split(':'); socket(S, k, +id); sfx.forge(); save(); closeModal(); renderAll(); return; }
    if (e.target.closest('#btn-skip')) { if (skipFight) skipFight(); return; }
    if (e.target.closest('#btn-close')) { closeModal(); return; }
    if (e.target.closest('#btn-reset-yes')) { S = fresh(); save(); closeModal(); setTab('road'); renderAll(); return; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden && !busy) closeModal(); });

  // ---------- 分頁 ----------
  function setTab(k) {
    tab = k;
    ['road', 'stone', 'forge'].forEach(x => { $('#tab-' + x).hidden = x !== k; document.querySelector(`[data-tab="${x}"]`).setAttribute('aria-selected', String(x === k)); });
    window.scrollTo(0, 0);
    try { localStorage.setItem('forge.tab', k); } catch (e) {}
  }
  function focusNext() {
    const n = document.querySelector('.stage.next');
    if (n && S.cleared > 2) n.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { setTab(b.dataset.tab); renderAll(); if (b.dataset.tab === 'road') focusNext(); } });

  function renderAll() {
    renderHud();
    if (tab === 'road') renderRoad(); else if (tab === 'stone') renderStone(); else renderForge();
  }

  // ---------- 語言 ----------
  function applyLang() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
    document.querySelectorAll('[data-t]').forEach(el => { const v = L[lang][el.dataset.t]; el.innerHTML = typeof v === 'function' ? v(FUSE_RATE.map(x => Math.round(x * 100))) : v; });
    $('#btn-lang').textContent = t('langBtn');
    $('#btn-sound').textContent = soundOn ? t('soundOn') : t('soundOff');
    $('#btn-reset').textContent = t('resetBtn');
    renderAll();
  }
  $('#btn-lang').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; try { localStorage.setItem('forge.lang', lang); } catch (e) {} applyLang(); });
  $('#btn-sound').addEventListener('click', () => { soundOn = !soundOn; applyLang(); });
  $('#btn-reset').addEventListener('click', () => {
    openModal(`<h2>${t('resetBtn')}</h2><p class="muted" style="margin:0">${t('resetQ')}</p><div class="row"><button class="btn ghost" id="btn-close">${t('cancel')}</button><button class="btn gold" id="btn-reset-yes">${t('resetYes')}</button></div>`);
  });

  // ---------- 啟動 ----------
  function boot(data) {
    S = (data && data.S && data.S.equip) ? data.S : (load() || fresh());
    if (!S.stall || !S.stall.length && S.stats.wins === 0) refreshStall(S, rng, true);
    let k = 'road'; try { k = localStorage.getItem('forge.tab') || 'road'; } catch (e) {}
    setTab(['road', 'stone', 'forge'].includes(k) ? k : 'road');
    applyLang();
    if (tab === 'road') focusNext();
  }
  window.claude?.hot?.snapshot?.(() => ({ S }));
  if (window.claude?.hot?.ready) window.claude.hot.ready(boot);
  else if (P && P.readSave) P.readSave().then(txt => boot({ S: parseSave(txt) })).catch(() => boot(null));
  else boot(window.claude?.hot?.data);
})();

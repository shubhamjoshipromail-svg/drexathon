// Shout Command: a voice-commanded swarm. Every creature's decision comes from Drex.
const W = 1100, H = 680;
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);

const ORDER_MODEL = 'drex-max-v1.1'; // best at routing messy orders (39/40 in probe)
const REFLEX_MODEL = 'drex-v2.0';    // fastest (~50 ms eval) for the autonomous loop
const REFLEX_EVERY = 4;               // seconds
const GENERAL_EVERY = 14;             // seconds between LLM general orders
const WIN_SCORE = 300;

// ---------- map ----------
const ZONES = {
  blue_nest: { name: 'our nest', x: 80, y: 340, r: 62, nest: 'blue' },
  red_nest: { name: 'enemy nest', x: 1020, y: 340, r: 62, nest: 'red' },
  north: { name: 'north reef', x: 550, y: 105, r: 58, cp: true },
  south: { name: 'south reef', x: 550, y: 575, r: 58, cp: true },
  vent: { name: 'the vent', x: 550, y: 340, r: 58, cp: true },
  kelp: { name: 'kelp forest', x: 290, y: 520, r: 54, cp: true },
  trench: { name: 'the trench', x: 810, y: 165, r: 54, cp: true },
};
const CP = Object.keys(ZONES).filter(k => ZONES[k].cp);
const zoneName = (k, team) => k === 'blue_nest' ? (team === 'blue' ? 'our nest' : 'the enemy nest')
  : k === 'red_nest' ? (team === 'red' ? 'our nest' : 'the enemy nest') : ZONES[k].name;

const ROLES = {
  biter: { hp: 130, dmg: 10, range: 24, speed: 58, cd: 0.9, desc: 'tough melee fighter', glyph: 'B' },
  spitter: { hp: 75, dmg: 8, range: 120, speed: 50, cd: 1.2, desc: 'ranged attacker, fragile', glyph: 'S' },
  darter: { hp: 60, dmg: 5, range: 22, speed: 105, cd: 0.7, desc: 'very fast scout', glyph: 'D' },
  mender: { hp: 70, dmg: 0, range: 0, speed: 62, cd: 1, heal: 9, healRange: 85, desc: 'healer, cannot attack', glyph: 'M' },
};
const ROSTER = [['B1', 'biter'], ['B2', 'biter'], ['B3', 'biter'], ['S1', 'spitter'], ['S2', 'spitter'], ['S3', 'spitter'], ['D1', 'darter'], ['D2', 'darter'], ['M1', 'mender'], ['M2', 'mender']];
const TEAM = { blue: { name: 'Blue swarm', color: '#3fa9ff', nest: 'blue_nest' }, red: { name: 'Red swarm', color: '#ff5a5f', nest: 'red_nest' } };
const other = t => t === 'blue' ? 'red' : 'blue';

// ---------- sprites (optional, Firefly art dropped into public/assets) ----------
const sprites = {};
function loadImg(key, src) { const im = new Image(); im.onload = () => sprites[key] = im; im.src = src; }
for (const t of ['blue', 'red']) for (const r of Object.keys(ROLES)) loadImg(`${t}_${r}`, `assets/${t}_${r}.png`);
loadImg('bg', 'assets/bg.jpg'); loadImg('nest_blue', 'assets/nest_blue.png'); loadImg('nest_red', 'assets/nest_red.png');

// ---------- state ----------
let units = [], fx = [], time = 0, running = false, paused = false;
const score = { blue: 0, red: 0 };
const nests = { blue: { hp: 800, max: 800 }, red: { hp: 800, max: 800 } };
const owner = Object.fromEntries(CP.map(k => [k, null]));
const stats = { decisions: 0, calls: 0, drexMs: [], tokens: 0, llmMs: [], reflexOverrides: 0 };
let doctrine = []; // [{rule, page}]

function spawnAll() {
  units = [];
  for (const team of ['blue', 'red']) ROSTER.forEach(([id, role], i) => {
    const n = ZONES[TEAM[team].nest];
    units.push({ key: `${team}:${id}`, id, team, role, x: n.x + (team === 'blue' ? 40 : -40) + Math.cos(i) * 30, y: n.y - 120 + i * 26,
      hp: ROLES[role].hp, alive: true, cd: Math.random(), task: { kind: 'hold' }, holdX: null, holdY: null, bubble: null, respawnAt: 0, phase: Math.random() * 6.28 });
  });
  units.forEach(u => { u.holdX = u.x; u.holdY = u.y; });
}

// ---------- tasks ----------
function taskText(u) {
  const t = u.task;
  switch (t.kind) {
    case 'goto': return `heading to ${zoneName(t.zone, u.team)}`;
    case 'attack': return t.local ? 'fighting nearby enemies' : 'hunting the nearest enemies';
    case 'retreat': return 'retreating to our nest';
    case 'hold': return 'holding position';
    case 'heal': return 'healing injured allies';
    case 'nest': return 'assaulting the enemy nest';
  }
  return 'idle';
}
function optionsFor(u) {
  const o = {
    keep: `Keep my current task (${taskText(u)}). Choose this if the order is not meant for me.`,
    attack: 'Attack the nearest enemy creatures',
    retreat: 'Retreat to our nest',
    hold: 'Stop and hold position right where I am',
    nest: 'Assault the enemy nest',
  };
  for (const z of CP) o[`go_${z}`] = `Move to ${ZONES[z].name}`;
  if (u.role === 'mender') o.heal = 'Follow and heal injured allies';
  return o;
}
function setTask(u, choice, extra = {}) {
  if (choice === 'keep') return false;
  const prev = u.task;
  if (choice.startsWith('go_')) u.task = { kind: 'goto', zone: choice.slice(3) };
  else if (choice === 'hold') { u.task = { kind: 'hold' }; u.holdX = u.x; u.holdY = u.y; }
  else u.task = { kind: choice };
  Object.assign(u.task, extra);
  if (extra.resume) u.task.resume = prev.resume || prev;
  return true;
}

// ---------- geometry helpers ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function nearestZone(p) { let best, bd = 1e9; for (const k in ZONES) { const d = dist(p, ZONES[k]); if (d < bd) { bd = d; best = k; } } return [best, bd]; }
function where(u) {
  const [k, d] = nearestZone(u);
  return d < ZONES[k].r * 1.3 ? `at ${zoneName(k, u.team)}` : `near ${zoneName(k, u.team)}`;
}
const living = team => units.filter(u => u.alive && u.team === team);
const hpPct = u => Math.round(100 * u.hp / ROLES[u.role].hp);

// ---------- situation text for Drex / the LLM general ----------
function situation(team) {
  const foe = other(team);
  const side = team === 'blue' ? 'west (left)' : 'east (right)';
  const cps = CP.map(k => `${ZONES[k].name}: ${owner[k] === team ? 'held by us' : owner[k] === foe ? 'held by the enemy' : 'unclaimed'}`).join('; ');
  const mine = living(team).map(u => `${u.id}: ${u.role} (${ROLES[u.role].desc}), ${where(u)}, health ${hpPct(u)}%, ${taskText(u)}`).join('\n');
  const dead = units.filter(u => u.team === team && !u.alive).map(u => u.id);
  const foeCount = {};
  for (const e of living(foe)) { const w = where(e); foeCount[w] = (foeCount[w] || 0) + 1; }
  const foes = Object.entries(foeCount).map(([w, n]) => `${n} ${w}`).join(', ') || 'none visible';
  let s = `We are the ${TEAM[team].name}. Our nest is on the ${side} side of the map.\n` +
    `Control points: ${cps}.\nScore: us ${Math.floor(score[team])}, enemy ${Math.floor(score[foe])}. Our nest health ${Math.round(100 * nests[team].hp / nests[team].max)}%, enemy nest health ${Math.round(100 * nests[foe].hp / nests[foe].max)}%.\n` +
    `Our creatures:\n${mine}` + (dead.length ? `\nRespawning: ${dead.join(', ')}` : '') + `\nEnemy creatures: ${foes}.`;
  return s;
}
// Doctrine rules that apply to this creature's type only (sharing all rules made Drex over-apply them).
function rulesFor(u) {
  if (u.team !== 'blue' || !doctrine.length) return '';
  const mine = doctrine.filter(d => /all|every/i.test(d.applies_to) || new RegExp(u.role, 'i').test(d.applies_to));
  return mine.length ? ` Your field manual binds you (it overrides the commander): ${mine.map(d => d.rule.replace(/^Rule [^:]+: /, '')).join(' ')}` : '';
}

// ---------- Drex ----------
async function drex(model, state, questions) {
  const t0 = performance.now();
  const r = await fetch('/api/drex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, state, questions }) });
  const j = await r.json();
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j).slice(0, 200));
  stats.calls++; stats.decisions += Object.keys(questions).length; stats.drexMs.push(ms); stats.tokens += j.usage?.input_tokens || 0;
  return { answers: j.answers, ms, evalMs: j.evaluation_time_ms };
}

async function issueOrder(team, text, who) {
  text = text.trim(); if (!text) return;
  const us = living(team); if (!us.length) return;
  const entry = log(team, who, text, 'Drex is deciding for every creature…');
  const questions = {};
  for (const u of us) {
    questions[`${u.id}_to`] = { type: 'noul', instructions: `Is the commander's order addressed to ${u.id} (a ${u.role})? Orders can address creatures by name (like ${u.id}), by type (like "${u.role}s"), by where they are, by their health, or everyone at once.` };
    questions[u.id] = { type: 'choice', instructions: `You are ${u.id}, a ${u.role} (${ROLES[u.role].desc}), ${where(u)}, health ${hpPct(u)}%, currently ${taskText(u)}. The commander just ordered: "${text}". What should YOU do now? If the order is not meant for you, choose keep.${rulesFor(u)}`, criteria: optionsFor(u) };
  }
  try {
    const { answers, ms, evalMs } = await drex(ORDER_MODEL, `${situation(team)}\n\nCommander's order: "${text}"`, questions);
    const moved = [], refused = [];
    for (const u of us) {
      const p = answers[`${u.id}_to`]?.noul ?? 0; const a = answers[u.id];
      if (!a) continue;
      const obey = p >= 0.4 && a.choice !== 'keep';
      const bound = p >= 0.6 && rulesFor(u) && (a.choice === 'keep' || a.choice === 'hold');
      if (obey && a.choice !== 'hold' || obey && !bound) { setTask(u, a.choice); moved.push(`${u.id}→${a.choice.replace('go_', '')}`); }
      else if (bound) { setTask(u, a.choice); refused.push(u.id); }
      u.bubble = { p, label: bound ? '📜 manual' : obey ? a.choice.replace('go_', '→') : '', until: time + 3.5 };
    }
    entry.res.innerHTML = `<span class="fast">${Object.keys(questions).length} decisions in ${ms} ms</span> (model ${Math.round(evalMs)} ms)<br>${moved.join('  ') || (refused.length ? '' : 'nobody thought that was for them')}` +
      (refused.length ? `<br><span style="color:var(--gold)">📜 ${refused.join(', ')} refused: field manual forbids it</span>` : '');
  } catch (e) { entry.res.innerHTML = `<span class="slow">Drex error: ${e.message}</span>`; }
}

// Autonomous reflexes: every creature decides on its own whether to deviate from orders.
let reflexBusy = { blue: false, red: false };
async function reflexes(team) {
  if (reflexBusy[team] || !$('reflexes').checked) return;
  const all = living(team);
  // only creatures facing something worth reacting to get asked
  const us = all.filter(u => !u.task.reflex && (living(other(team)).some(e => dist(e, u) < 150) || hpPct(u) < 45 ||
    (u.role === 'mender' && all.some(a => a !== u && dist(a, u) < 200 && hpPct(a) < 60))));
  if (!us.length) return;
  reflexBusy[team] = true;
  const questions = {};
  for (const u of us) {
    const near = living(other(team)).filter(e => dist(e, u) < 150).length;
    const allies = all.filter(a => a !== u && dist(a, u) < 150).length;
    const hurt = all.filter(a => a !== u && dist(a, u) < 200 && hpPct(a) < 60).length;
    const crit = { keep: `Keep following orders (${taskText(u)})`, flee: 'Flee to our nest to recover', fight: 'Turn and fight the enemies right next to me' };
    if (u.role === 'mender') { delete crit.fight; crit.heal = 'Heal the injured allies next to me'; }
    questions[u.id] = { type: 'choice', criteria: crit, instructions: `You are ${u.id}, a ${u.role} (${ROLES[u.role].desc}), ${where(u)}, health ${hpPct(u)}%, currently ${taskText(u)}. ${near} enemies within striking distance, ${allies} allies nearby, ${hurt} injured allies nearby. Should you keep following your orders, or react on your own instinct? Only deviate when it clearly helps the swarm.${rulesFor(u)}` };
  }
  try {
    const { answers, ms } = await drex(REFLEX_MODEL, situation(team), questions);
    const acts = [];
    for (const u of us) {
      const a = answers[u.id]; if (!u.alive || !a || a.choice === 'keep' || a.confidence < 0.6) continue;
      if (u.task.reflex) continue; // already reacting
      const map = { flee: 'retreat', fight: 'attack', heal: 'heal' };
      setTask(u, map[a.choice], { reflex: true, resume: true, local: a.choice === 'fight' });
      u.bubble = { p: a.confidence, label: `⚡${a.choice}`, until: time + 3, reflex: true };
      acts.push(`${u.id} ${a.choice}`); stats.reflexOverrides++;
    }
    if (acts.length) log(team, 'reflexes', '', `<span class="fast">${us.length} creatures decided in ${ms} ms</span><br>⚡ ${acts.join(', ')}`);
  } catch (e) { console.warn('reflex', e); }
  reflexBusy[team] = false;
}

// ---------- LLM general (red) ----------
const SCRIPTED = ['Biters, take the vent!', 'Spitters, cover the north reef', 'Darters, raid the kelp forest', 'Everyone push to the vent', 'Menders, heal the biters', 'Biters attack the enemy nest!'];
let generalBusy = false, scriptedIdx = 0, llmOk = null;
async function general() {
  if (generalBusy) return; generalBusy = true;
  let text = null, ms = 0;
  if (llmOk !== false) {
    const t0 = performance.now();
    try {
      const r = await fetch('/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [
        { role: 'system', content: 'You are the ruthless general of the Red swarm in a real-time battle between swarms of sea creatures. Your creatures: biters (melee), spitters (ranged), darters (fast), menders (healers), named B1-B3, S1-S3, D1-D2, M1-M2. Places: north reef, south reef, the vent, kelp forest, the trench, our nest, the enemy nest. Holding places scores points. Reply with ONE short shouted order, under 15 words, addressing creatures by name, by type, or everyone. Output only the order.' },
        { role: 'user', content: situation('red') },
      ] }) });
      const j = await r.json(); ms = Math.round(performance.now() - t0);
      if (r.ok) { text = j.choices?.[0]?.message?.content?.trim().replace(/^"|"$/g, ''); llmOk = true; stats.llmMs.push(ms); }
      else { llmOk = false; console.warn('llm', j); }
    } catch (e) { llmOk = false; }
  }
  if (!text) text = SCRIPTED[scriptedIdx++ % SCRIPTED.length];
  showGeneral(text, ms);
  await issueOrder('red', text, llmOk ? `LLM general (thought ${(ms / 1000).toFixed(1)} s)` : 'scripted general');
  generalBusy = false;
}
let generalSay = null;
function showGeneral(text, ms) { generalSay = { text, until: time + 5 }; }

// ---------- simulation ----------
function targetPoint(u) {
  const t = u.task, foes = living(other(u.team));
  switch (t.kind) {
    case 'goto': { const z = ZONES[t.zone]; return { x: z.x + Math.cos(u.phase) * z.r * 0.55, y: z.y + Math.sin(u.phase) * z.r * 0.55, stop: 6 }; }
    case 'retreat': { const z = ZONES[TEAM[u.team].nest]; return { x: z.x + Math.cos(u.phase) * 35, y: z.y + Math.sin(u.phase) * 35, stop: 6 }; }
    case 'nest': { const z = ZONES[TEAM[other(u.team)].nest]; return { x: z.x + Math.cos(u.phase) * 50, y: z.y + Math.sin(u.phase) * 50, stop: Math.max(10, ROLES[u.role].range - 10) }; }
    case 'attack': {
      let best = null, bd = t.local ? 220 : 1e9;
      for (const e of foes) { const d = dist(u, e); if (d < bd) { bd = d; best = e; } }
      if (!best) { if (t.resume) { u.task = t.resume; } return null; }
      return { x: best.x, y: best.y, stop: Math.max(12, ROLES[u.role].range * 0.85) };
    }
    case 'heal': {
      const allies = living(u.team).filter(a => a !== u);
      let best = null, bh = 1.01;
      for (const a of allies) { const h = a.hp / ROLES[a.role].hp; if (h < bh) { bh = h; best = a; } }
      if (!best) return null;
      if (t.reflex && bh > 0.95 && t.resume) { u.task = t.resume; return null; }
      return { x: best.x, y: best.y, stop: 40 };
    }
    case 'hold': return u.holdX != null ? { x: u.holdX, y: u.holdY, stop: 4 } : null;
  }
  return null;
}

function step(dt) {
  time += dt;
  for (const u of units) {
    if (!u.alive) {
      if (time >= u.respawnAt) { const n = ZONES[TEAM[u.team].nest]; Object.assign(u, { alive: true, hp: ROLES[u.role].hp, x: n.x, y: n.y + (Math.random() - .5) * 60 }); }
      continue;
    }
    const R = ROLES[u.role];
    u.cd -= dt;
    // movement
    const tp = targetPoint(u);
    if (tp) {
      const dx = tp.x - u.x, dy = tp.y - u.y, d = Math.hypot(dx, dy);
      if (d > tp.stop) { const s = Math.min(R.speed * dt, d - tp.stop); u.x += dx / d * s; u.y += dy / d * s; }
    }
    // separation
    for (const o of units) if (o !== u && o.alive) { const d = dist(u, o); if (d < 16 && d > 0) { u.x += (u.x - o.x) / d * (16 - d) * 0.5; u.y += (u.y - o.y) / d * (16 - d) * 0.5; } }
    u.x = Math.max(12, Math.min(W - 12, u.x)); u.y = Math.max(12, Math.min(H - 12, u.y));
    // retreat finished: recover at nest then resume
    const home = ZONES[TEAM[u.team].nest];
    if (dist(u, home) < home.r) u.hp = Math.min(R.hp, u.hp + 10 * dt);
    if (u.task.kind === 'retreat' && u.task.resume && hpPct(u) >= 90 && dist(u, home) < home.r) u.task = u.task.resume;
    // combat
    if (u.cd <= 0) {
      if (R.dmg) {
        let tgt = null, bd = R.range + 8;
        for (const e of units) if (e.alive && e.team !== u.team) { const d = dist(u, e); if (d < bd) { bd = d; tgt = e; } }
        if (tgt) {
          tgt.hp -= R.dmg; u.cd = R.cd;
          fx.push({ x1: u.x, y1: u.y, x2: tgt.x, y2: tgt.y, c: TEAM[u.team].color, t: 0.25, ranged: R.range > 50 });
          if (tgt.hp <= 0) { tgt.alive = false; tgt.respawnAt = time + 8; fx.push({ x: tgt.x, y: tgt.y, boom: true, c: TEAM[tgt.team].color, t: 0.6 }); }
        } else {
          const en = ZONES[TEAM[other(u.team)].nest];
          if (dist(u, en) < en.r + R.range) { nests[other(u.team)].hp -= R.dmg; u.cd = R.cd; fx.push({ x1: u.x, y1: u.y, x2: en.x, y2: en.y, c: TEAM[u.team].color, t: 0.25, ranged: R.range > 50 }); }
        }
      } else if (R.heal) {
        let tgt = null, bh = 0.98;
        for (const a of units) if (a.alive && a.team === u.team && a !== u && dist(a, u) < R.healRange) { const h = a.hp / ROLES[a.role].hp; if (h < bh) { bh = h; tgt = a; } }
        if (tgt) { tgt.hp = Math.min(ROLES[tgt.role].hp, tgt.hp + R.heal); u.cd = R.cd; fx.push({ x1: u.x, y1: u.y, x2: tgt.x, y2: tgt.y, c: '#4fe3a1', t: 0.3, heal: true }); }
      }
    }
  }
  // control points
  for (const k of CP) {
    const z = ZONES[k], n = { blue: 0, red: 0 };
    for (const u of units) if (u.alive && dist(u, z) < z.r) n[u.team]++;
    if (n.blue > n.red) owner[k] = 'blue'; else if (n.red > n.blue) owner[k] = 'red';
    if (owner[k]) score[owner[k]] += dt;
  }
  fx = fx.filter(f => (f.t -= dt) > 0);
  const winner = nests.red.hp <= 0 || score.blue >= WIN_SCORE ? 'blue' : nests.blue.hp <= 0 || score.red >= WIN_SCORE ? 'red' : null;
  if (winner) endGame(winner);
}

// ---------- rendering ----------
function draw() {
  ctx.clearRect(0, 0, W, H);
  if (sprites.bg) { ctx.drawImage(sprites.bg, 0, 0, W, H); ctx.fillStyle = 'rgba(3,10,20,.35)'; ctx.fillRect(0, 0, W, H); }
  else {
    const g = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 700); g.addColorStop(0, '#0b2238'); g.addColorStop(1, '#040b15');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.06; ctx.strokeStyle = '#7fd1ff';
    for (let i = 0; i < 14; i++) { ctx.beginPath(); for (let x = 0; x <= W; x += 20) ctx.lineTo(x, 50 * i + Math.sin(x / 90 + time * 0.6 + i) * 8); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // zones
  for (const k in ZONES) {
    const z = ZONES[k];
    const col = z.nest ? TEAM[z.nest].color : owner[k] ? TEAM[owner[k]].color : '#7b8ea8';
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 6.283);
    ctx.fillStyle = col + (z.nest ? '22' : '18'); ctx.fill();
    ctx.setLineDash(z.nest ? [] : [6, 6]); ctx.strokeStyle = col + 'aa'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    if (z.nest && sprites[`nest_${z.nest}`]) ctx.drawImage(sprites[`nest_${z.nest}`], z.x - z.r, z.y - z.r, z.r * 2, z.r * 2);
    ctx.fillStyle = '#d9e6f5cc'; ctx.font = '600 13px Space Grotesk'; ctx.textAlign = 'center';
    ctx.fillText(z.nest ? `${TEAM[z.nest].name} nest` : z.name, z.x, z.y - z.r - 8);
    if (z.nest) { const n = nests[z.nest]; ctx.fillStyle = '#0008'; ctx.fillRect(z.x - 40, z.y + z.r + 6, 80, 6); ctx.fillStyle = col; ctx.fillRect(z.x - 40, z.y + z.r + 6, 80 * Math.max(0, n.hp / n.max), 6); }
  }
  // fx
  for (const f of fx) {
    if (f.boom) { ctx.beginPath(); ctx.arc(f.x, f.y, 26 * (1 - f.t / 0.6) + 4, 0, 6.283); ctx.strokeStyle = f.c; ctx.globalAlpha = f.t / 0.6; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1; continue; }
    ctx.strokeStyle = f.c; ctx.globalAlpha = Math.min(1, f.t * 4); ctx.lineWidth = f.ranged ? 2 : 3;
    if (f.ranged || f.heal) { ctx.setLineDash(f.heal ? [3, 4] : []); const p = 1 - f.t / 0.25; ctx.beginPath(); ctx.arc(f.x1 + (f.x2 - f.x1) * p, f.y1 + (f.y2 - f.y1) * p, 3, 0, 6.283); ctx.fillStyle = f.c; ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.globalAlpha *= 0.35; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  // units
  for (const u of units) {
    if (!u.alive) continue;
    const col = TEAM[u.team].color, sp = sprites[`${u.team}_${u.role}`];
    const bob = Math.sin(time * 4 + u.phase) * 1.5;
    if (u.task.kind === 'goto' || u.task.kind === 'nest') {
      const tp = targetPoint(u); if (tp) { ctx.strokeStyle = col + '22'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(tp.x, tp.y); ctx.stroke(); }
    }
    if (sp) ctx.drawImage(sp, u.x - 16, u.y - 16 + bob, 32, 32);
    else {
      ctx.beginPath(); ctx.arc(u.x, u.y + bob, 11, 0, 6.283); ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff55'; ctx.stroke();
      ctx.fillStyle = '#04101e'; ctx.font = '700 11px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillText(u.id, u.x, u.y + 4 + bob);
    }
    // hp
    ctx.fillStyle = '#0009'; ctx.fillRect(u.x - 12, u.y - 19, 24, 3); ctx.fillStyle = hpPct(u) > 40 ? '#4fe3a1' : '#ffd166'; ctx.fillRect(u.x - 12, u.y - 19, 24 * u.hp / ROLES[u.role].hp, 3);
    if (sp) { ctx.fillStyle = '#d9e6f5'; ctx.font = '600 9px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillText(u.id, u.x, u.y + 26); }
    // decision bubble: probability this order was for me
    if (u.bubble && u.bubble.until > time) {
      const b = u.bubble, a = Math.min(1, (b.until - time));
      ctx.globalAlpha = a;
      const w = 34; ctx.fillStyle = '#000a'; ctx.fillRect(u.x - w / 2, u.y - 34, w, 11);
      ctx.fillStyle = b.reflex ? '#ffd166' : col; ctx.fillRect(u.x - w / 2, u.y - 34, w * b.p, 11);
      ctx.fillStyle = '#fff'; ctx.font = '600 9px JetBrains Mono'; ctx.textAlign = 'center';
      ctx.fillText(b.reflex ? b.label : `${Math.round(b.p * 100)}%`, u.x, u.y - 25.5);
      if (b.label && !b.reflex) { ctx.fillStyle = '#ffd166'; ctx.fillText(b.label, u.x, u.y - 38); }
      ctx.globalAlpha = 1;
    }
  }
  // general speech
  if (generalSay && generalSay.until > time) {
    const n = ZONES.red_nest; ctx.font = '600 15px Space Grotesk'; const tw = ctx.measureText(generalSay.text).width + 24;
    const x = Math.min(W - tw / 2 - 8, n.x - 40), y = 40;
    ctx.fillStyle = '#ff5a5fee'; ctx.beginPath(); ctx.roundRect(x - tw / 2, y - 18, tw, 32, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(`"${generalSay.text}"`, x, y + 3);
  }
  if (shoutSay && shoutSay.until > time) {
    ctx.font = '700 22px Space Grotesk'; const tw = ctx.measureText(shoutSay.text).width + 30;
    ctx.globalAlpha = Math.min(1, shoutSay.until - time);
    ctx.fillStyle = '#3fa9ffee'; ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2, H - 70, tw, 40, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(`"${shoutSay.text}"`, W / 2, H - 43); ctx.globalAlpha = 1;
  }
}
let shoutSay = null;

// ---------- UI ----------
function log(team, who, text, res) {
  const el = document.createElement('div'); el.className = `entry ${team}`;
  el.innerHTML = `<div class="who">${team === 'sys' ? '' : TEAM[team].name + ' · '}${who}</div>${text ? `<div class="txt">"${text.replace(/</g, '&lt;')}"</div>` : ''}<div class="res">${res}</div>`;
  $('log').prepend(el);
  while ($('log').children.length > 60) $('log').lastChild.remove();
  return { el, res: el.querySelector('.res') };
}
function renderStats() {
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
  const cost = stats.tokens * 0.06 / 1e6;
  $('stats').innerHTML = `
    <div><span class="lbl">Drex decisions</span><b>${stats.decisions}</b></div>
    <div><span class="lbl">avg Drex call</span><b class="fast">${avg(stats.drexMs)} ms</b></div>
    <div><span class="lbl">LLM general avg</span><b class="slow">${stats.llmMs.length ? (avg(stats.llmMs) / 1000).toFixed(1) + ' s' : '—'}</b></div>
    <div><span class="lbl">Drex cost so far</span><b>$${cost.toFixed(5)}</b></div>
    <div><span class="lbl">reflex overrides</span><b>${stats.reflexOverrides}</b></div>
    <div><span class="lbl">API calls</span><b>${stats.calls}</b></div>`;
  $('sb').textContent = Math.floor(score.blue); $('sr').textContent = Math.floor(score.red);
  $('clock').textContent = `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
}

function submitOrder(text) {
  text = text.trim(); if (!text || !running) return;
  shoutSay = { text, until: time + 3 };
  issueOrder('blue', text, 'you');
}
$('order').addEventListener('keydown', e => { if (e.key === 'Enter') { submitOrder(e.target.value); e.target.value = ''; } });
const CHIPS = ['Biters, take the vent!', 'Spitters cover the biters', 'Darters grab the kelp forest and the south reef', 'Menders, stay behind the biters and heal them', 'Everyone charge the enemy nest!', 'Whoever is hurt, fall back', 'B2 and S1 hold the north reef, everyone else push the trench'];
$('chips').innerHTML = CHIPS.map(c => `<span class="chip">${c}</span>`).join('');
$('chips').addEventListener('click', e => { if (e.target.classList.contains('chip')) submitOrder(e.target.textContent); });

// voice: hold Space or click mic
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
function startListening() {
  if (!SR || listening) { if (!SR) $('interim').textContent = 'Speech recognition not supported here. Use Chrome, or type.'; return; }
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
  let finalText = '';
  rec.onresult = e => { let t = ''; for (const r of e.results) { t += r[0].transcript; if (r.isFinal) finalText = t; } $('interim').textContent = t; };
  rec.onend = () => { listening = false; $('mic').classList.remove('on'); const t = finalText || $('interim').textContent; if (t) submitOrder(t); setTimeout(() => $('interim').textContent = '', 1500); };
  rec.onerror = e => { $('interim').textContent = `mic: ${e.error}`; };
  rec.start(); listening = true; $('mic').classList.add('on');
}
function stopListening() { if (rec && listening) rec.stop(); }
window.addEventListener('keydown', e => { if (e.code === 'Space' && document.activeElement !== $('order') && !e.repeat) { e.preventDefault(); startListening(); } });
window.addEventListener('keyup', e => { if (e.code === 'Space' && document.activeElement !== $('order')) { e.preventDefault(); stopListening(); } });
$('mic').addEventListener('click', () => listening ? stopListening() : startListening());

$('pause').addEventListener('click', () => { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; });
$('start').addEventListener('click', startGame);

function startGame() {
  spawnAll(); time = 0; score.blue = score.red = 0; nests.blue.hp = nests.red.hp = 800; CP.forEach(k => owner[k] = null);
  $('overlay').style.display = 'none'; running = true; paused = false;
  $('log').innerHTML = ''; log('sys', 'battle', '', 'Battle started. Give your first order!');
  setTimeout(general, 1500);
}
function endGame(winner) {
  running = false;
  $('overlay').style.display = 'flex';
  $('overlay').querySelector('h2').innerHTML = `<span style="color:${TEAM[winner].color}">${TEAM[winner].name}</span> wins`;
  $('overlay').querySelector('p').innerHTML = `${stats.decisions} creature decisions made by Drex, average ${Math.round(stats.drexMs.reduce((a, b) => a + b, 0) / Math.max(1, stats.drexMs.length))} ms per call.`;
  $('start').textContent = 'Play again';
}

// timers
let last = performance.now(), sinceReflex = 0, sinceGeneral = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (running && !paused) {
    step(dt);
    sinceReflex += dt; sinceGeneral += dt;
    if (sinceReflex >= REFLEX_EVERY) { sinceReflex = 0; reflexes('blue'); setTimeout(() => reflexes('red'), 300); }
    if (sinceGeneral >= GENERAL_EVERY) { sinceGeneral = 0; general(); }
  }
  draw(); renderStats();
  requestAnimationFrame(frame);
}
fetch('/api/status').then(r => r.json()).then(s => {
  $('st-drex').classList.toggle('ok', s.drex); $('st-drex').textContent = s.drex ? 'Drex ✓' : 'Drex ✗';
  $('st-llm').classList.toggle('ok', s.llm); $('st-llm').textContent = s.llm ? `General: ${s.llmModel}` : 'General: scripted';
});
spawnAll();
requestAnimationFrame(frame);

// ---------- NDI field manual -> standing doctrine ----------
async function loadManual(blob) {
  $('doctrine').innerHTML = '<span style="color:var(--gold)">NDI is reading the scanned manual…</span>';
  try {
    const r = await fetch('/api/ndi/manual', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: blob });
    const j = await r.json();
    const res = j.extract?.result; if (!res?.data?.rules) throw new Error(JSON.stringify(j).slice(0, 200));
    const pages = {};
    for (const f of res.fields || []) { const m = f.path.match(/^\/rules\/(\d+)/); if (m && f.citations?.length) pages[m[1]] ??= f.citations[0].location?.page; }
    doctrine = res.data.rules.map((x, i) => ({ rule: `Rule ${x.number} (${x.applies_to}): ${x.rule}`, page: pages[i], ...x }));
    $('doctrine').innerHTML = doctrine.map(d => `<div>• <b>${d.applies_to}</b>: ${d.rule.replace(/^Rule [^:]+: /, '')} <span class="cite">Rule ${d.number} · p.${d.page ?? '?'}</span></div>`).join('') +
      `<div class="cite" style="margin-top:4px">${doctrine.length} rules extracted from the scan in ${(j.ms / 1000).toFixed(1)} s. Every Drex decision now obeys them.</div>`;
    log('sys', 'NDI', '', `Field manual loaded: ${doctrine.length} doctrine rules, cited to their pages.`);
  } catch (e) { $('doctrine').innerHTML = `<span class="slow">NDI error: ${e.message}</span>`; }
}
$('load-manual').addEventListener('click', async () => loadManual(await (await fetch('field-manual.pdf')).blob()));
$('manual-file').addEventListener('change', e => e.target.files[0] && loadManual(e.target.files[0]));

// expose for debugging
window.SC = { setDoctrine: d => { doctrine = d; }, issueOrder, situation, units: () => units };

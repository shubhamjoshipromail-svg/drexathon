// Drex capability probe: latency, concurrency, multi-question batching, order-routing accuracy.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const KEY = env.NACE_API_KEY;

async function drex(body) {
  const t = performance.now();
  const r = await fetch('https://console.nace.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return { status: r.status, ms: Math.round(performance.now() - t), j };
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)]; };

// Models
{
  const r = await fetch('https://console.nace.ai/v1/models', { headers: { Authorization: `Bearer ${KEY}` } });
  const j = await r.json();
  console.log('MODELS:', JSON.stringify(j).slice(0, 600));
}

if (process.argv[2] === 'routing') { globalThis.SKIP = true; }
// 1. Single-call latency per model
for (const model of globalThis.SKIP ? [] : ['drex-v2.0', 'drex-max-v1.1']) {
  const ms = [], ev = [];
  for (let i = 0; i < 5; i++) {
    const r = await drex({ model, state: 'The enemy is charging the left flank.', questions: { q: { type: 'noul', instructions: 'Is the left flank in danger?' } } });
    ms.push(r.ms); ev.push(r.j.evaluation_time_ms);
    if (r.status !== 200) console.log(model, r.status, JSON.stringify(r.j).slice(0, 300));
  }
  console.log(`LATENCY ${model}: roundtrip p50=${pct(ms, .5)} max=${Math.max(...ms)} | model eval p50=${pct(ev, .5)}`);
}

// 2. Concurrency: 30 parallel requests
if (!globalThis.SKIP) {
  const t = performance.now();
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => drex({ model: 'drex-v2.0', state: `Unit ${i} hears: retreat!`, questions: { q: { type: 'noul', instructions: 'Should the unit retreat?' } } })));
  const codes = {}; rs.forEach(r => codes[r.status] = (codes[r.status] || 0) + 1);
  console.log(`CONCURRENCY 30 parallel: wall=${Math.round(performance.now() - t)}ms statuses=${JSON.stringify(codes)} p50=${pct(rs.map(r => r.ms), .5)} max=${Math.max(...rs.map(r => r.ms))}`);
  const bad = rs.find(r => r.status !== 200); if (bad) console.log('  sample error:', JSON.stringify(bad.j).slice(0, 300));
}

// 3. Order routing: one request, one question per unit (shared state = battlefield + order)
const units = [
  { id: 'K1', role: 'knight', pos: 'left flank, front line', hp: 'full' },
  { id: 'K2', role: 'knight', pos: 'right flank, front line', hp: 'low' },
  { id: 'A1', role: 'archer', pos: 'left hill', hp: 'full' },
  { id: 'A2', role: 'archer', pos: 'center wall', hp: 'full' },
  { id: 'M1', role: 'medic', pos: 'rear camp', hp: 'full' },
];
const actions = {
  advance: 'Move toward the enemy',
  retreat: 'Fall back to the tower',
  hold: 'Stay in place and keep current task',
  attack_nearest: 'Attack the nearest enemy',
  cover_left: 'Move to support / give covering fire to the left flank',
  heal: 'Go heal the most injured friendly unit',
};
// [order, expected action per unit]
const cases = [
  ['Knights, fall back to the tower!', { K1: 'retreat', K2: 'retreat', A1: 'hold', A2: 'hold', M1: 'hold' }],
  ['Archers, cover the left flank.', { K1: 'hold', K2: 'hold', A1: 'cover_left', A2: 'cover_left', M1: 'hold' }],
  ['Everyone charge!!', { K1: 'advance', K2: 'advance', A1: 'advance', A2: 'advance', M1: 'advance' }],
  ['Medic, the guy on the right is dying, go help him', { K1: 'hold', K2: 'hold', A1: 'hold', A2: 'hold', M1: 'heal' }],
  ['Whoever is hurt, get out of there', { K1: 'hold', K2: 'retreat', A1: 'hold', A2: 'hold', M1: 'hold' }],
  ['left side guys, push forward, rest stay put', { K1: 'advance', K2: 'hold', A1: 'advance', A2: 'hold', M1: 'hold' }],
  ['uhh archers shoot whatever is closest', { K1: 'hold', K2: 'hold', A1: 'attack_nearest', A2: 'attack_nearest', M1: 'hold' }],
  ['K2 retreat, K1 keep fighting', { K1: 'attack_nearest', K2: 'retreat', A1: 'hold', A2: 'hold', M1: 'hold' }],
];
for (const model of ['drex-v2.0', 'drex-max-v1.1']) {
  let ok = 0, total = 0; const lat = []; const misses = [];
  for (const [order, exp] of cases) {
    const roster = units.map(u => `${u.id}: ${u.role}, at ${u.pos}, health ${u.hp}`).join('\n');
    const questions = Object.fromEntries(units.map(u => [u.id, {
      type: 'choice',
      instructions: `You are unit ${u.id} (${u.role}, at ${u.pos}, health ${u.hp}). The commander just shouted an order. If the order is not addressed to you, choose hold. Which action should YOU take now?`,
      criteria: actions,
    }]));
    const r = await drex({ model, state: `Squad roster:\n${roster}\n\nCommander's order: "${order}"`, questions });
    lat.push(r.ms);
    if (r.status !== 200) { console.log(model, r.status, JSON.stringify(r.j).slice(0, 400)); break; }
    for (const u of units) {
      const a = r.j.answers[u.id]; total++;
      if (a.choice === exp[u.id]) ok++; else misses.push(`"${order}" ${u.id}: got ${a.choice} (${(a.confidence ?? 0).toFixed(2)}) want ${exp[u.id]}`);
    }
  }
  console.log(`ROUTING ${model}: ${ok}/${total} correct, roundtrip p50=${pct(lat, .5)}ms max=${Math.max(...lat)}ms (5 questions/request)`);
  misses.forEach(m => console.log('   miss', m));
}

// 4. Scale: 50 unit-questions in one request
{
  const questions = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`u${i}`, { type: 'choice', instructions: `You are unit u${i}, a ${i % 2 ? 'archer' : 'knight'}. Which action now?`, criteria: actions }]));
  const r = await drex({ model: 'drex-v2.0', state: `Order: "Archers advance, knights hold."`, questions });
  const right = Object.entries(r.j.answers || {}).filter(([k, a]) => a.choice === (+k.slice(1) % 2 ? 'advance' : 'hold')).length;
  console.log(`SCALE 50 questions/1 request: status=${r.status} roundtrip=${r.ms}ms eval=${r.j.evaluation_time_ms}ms correct=${right}/50`);
}

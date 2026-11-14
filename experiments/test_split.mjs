// Swarm split check: within-ministry spread of caucus support after opening + one sentence. Usage: BASE=... node experiments/test_split.mjs
import fs from 'node:fs';
import { createEngine } from '../public/engine.js';
const config = JSON.parse(fs.readFileSync('experiments/out_config.json', 'utf8'));
const eng = createEngine({ base: process.env.BASE || 'http://localhost:5173', config, decision: 'Should I quit my job to join Lumen Labs as founding engineer?' });
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => Math.sqrt(mean(a.map(v => (v - mean(a)) ** 2)));
for (const t of ['I am putting this decision to the cabinet: Should I quit my job to join Lumen Labs as founding engineer?', 'Honestly I am bored, and this is the scary bet I promised myself once a year.']) {
  const t0 = Date.now(); await eng.sentence(t);
  console.log(`"${t.slice(0, 60)}" ${Date.now() - t0} ms`);
  for (const m of eng.state.ministers) { const v = eng.state.members.filter(c => c.ministry === m.id).map(c => c.support); console.log(`  ${m.short.padEnd(12)} mean ${mean(v).toFixed(2)} sd ${sd(v).toFixed(2)} min ${Math.min(...v).toFixed(1)} max ${Math.max(...v).toFixed(1)}`); }
  const all = eng.state.members.map(c => c.support); console.log(`  distinct rounded levels: ${new Set(all.map(Math.round)).size}, overall sd ${sd(all).toFixed(2)}`);
}

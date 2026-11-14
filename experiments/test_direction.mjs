// Direction test: 6 probe sentences, each with a senator that SHOULD move a known way. Fresh engine per probe
// (opening round, then the probe). Uses the config saved by test_engine.mjs (from a live NDI run) to skip NDI.
// Usage: BASE=http://localhost:5174 node experiments/test_direction.mjs
import fs from 'node:fs';
import { createEngine } from '../public/engine.js';
const base = process.env.BASE || 'http://localhost:5173';
const config = JSON.parse(fs.readFileSync('experiments/out_config.json', 'utf8'));
const decision = 'Should I quit my job to join Lumen Labs as founding engineer?';
const PROBES = [
  ['Health', -1, 'I would sleep five hours a night and work seventy-hour weeks to make this work.'],
  ['Family', -1, 'We would have to move to Austin, away from Sam and my parents.'],
  ['Finance', -1, 'Taking the pay cut would drain my savings down to about ten thousand dollars.'],
  ['Ambition', 1, 'I would learn more in one year there than in five years at my current job.'],
  ['Adventure', 1, 'This is the scariest and most exciting thing I have ever considered doing.'],
  ['Future Self', -1, 'Honestly they could run out of money any month now, there is no revenue yet.'],
];
let ok = 0; const rows = [];
for (const [who, dir, text] of PROBES) {
  const eng = createEngine({ base, config, decision });
  await eng.sentence(`I am putting this decision to the cabinet: ${decision}`);
  const m = eng.state.ministers.find(x => x.short === who);
  const before = m.stance; await eng.sentence(text); const d = m.stance - before;
  const pass = Math.sign(d) === dir && Math.abs(d) >= 0.05; ok += pass;
  const biggest = eng.state.ministers.map(x => [x.short, x.history.at(-1).stance - x.history.at(-2).stance]).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]))[0];
  rows.push(`${pass ? 'PASS' : 'FAIL'} ${who.padEnd(11)} expected ${dir > 0 ? 'up  ' : 'down'} got ${d >= 0 ? '+' : ''}${d.toFixed(2)} (${before.toFixed(2)} -> ${m.stance.toFixed(2)}); biggest mover: ${biggest[0]} ${biggest[1].toFixed(2)} | "${text}"`);
  console.log(rows.at(-1));
}
console.log(`\nDIRECTION ${ok}/${PROBES.length}`);
fs.writeFileSync('experiments/out_direction.txt', rows.join('\n') + `\nDIRECTION ${ok}/${PROBES.length}\n`);

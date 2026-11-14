// Variety + swarm ablation, all live. Usage: BASE=http://localhost:5174 node experiments/test_variety.mjs
import fs from 'node:fs';
import { buildConfig, createEngine, readConstitutionText } from '../public/engine.js';
import { CONSTITUTION_SCHEMA } from '../public/schemas.js';
const base = process.env.BASE || 'http://localhost:5173';
const out = []; const log = s => { console.log(s); out.push(s); };
async function ndiUrl(url) { const r = await fetch(base + '/api/ndi/url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, schema: CONSTITUTION_SCHEMA }) }); const j = await r.json(); if (j.extract?.status !== 'succeeded') throw new Error(JSON.stringify(j).slice(0, 300)); return j.extract.result; }
async function run(title, config, decision, sentences, opts = {}) {
  log(`\n=== ${title}\nMotion: ${decision}`);
  const eng = createEngine({ base, config, decision, ...opts });
  eng.on('interrupt', x => log(`  >> ${x.short} ${x.kind === 'question' ? 'ASKS' : 'says'}: ${x.line}`));
  await (opts.skipLlm ? eng.sentence(`I am putting this decision to the cabinet: ${decision}`) : eng.start());
  for (const s of sentences) { await eng.sentence(s); log(`  "${s}"\n    ` + eng.state.ministers.map(m => `${m.short} ${m.stance.toFixed(1)}`).join(' | ')); }
  await new Promise(r => setTimeout(r, 4000));
  const v = await eng.vote();
  log(`  VERDICT ${v.passed ? 'PASSED' : 'REJECTED'} share ${(v.share * 100).toFixed(0)}% need ${v.threshold} (${v.thresholdReason}); vetoes ${v.vetoes.map(x => x.short + ' ' + x.inScopeP.toFixed(2)).join(', ') || 'none'}\n  votes ${v.votes.map(x => `${x.short}:${x.vote}${x.caucus ? ` [caucus ${x.caucus.against}/${x.caucus.n} against]` : ''}`).join(' | ')}`);
  return v;
}
// A. A real constitution, read by NDI from the web
try {
  const t = Date.now(); const us = await ndiUrl('https://www.archives.gov/founding-docs/constitution-transcript');
  const cfg = buildConfig(us, []);
  log(`US Constitution via NDI ${Date.now() - t} ms: ${cfg.ministries.map(m => `${m.name} w${m.vote_weight}${m.has_veto ? ' VETO(' + m.veto_scope.slice(0, 60) + ')' : ''}`).join('; ')}\n  passage ${JSON.stringify(cfg.passage).slice(0, 200)}\n  rules ${cfg.rules.length}`);
  await run('US Constitution', cfg, 'Should the federal government adopt a four-day work week for all federal employees?', ['It would cost nothing in pay and studies show productivity holds.', 'But it would be done by executive order, without a vote in Congress.']);
} catch (e) { log('US constitution failed: ' + e.message); }
// B/C. Philosophical + values questions on the personal constitution
const mine = buildConfig((await readConstitutionText(base, fs.readFileSync('samples/constitution-template.txt', 'utf8'))).result, []);
await run('Philosophical', mine, 'What is the point of life?', ['I think the point is to build things that outlast me, even if I sacrifice comfort.']);
await run('Values', mine, 'Should I chase meaning over money in my thirties?', ['I would take a 40 percent pay cut to work on something I believe in.', 'My savings would still cover eight months.']);
// D. Swarm ablation: identical inputs, caucus feedback on vs off (2 runs each)
const job = JSON.parse(fs.readFileSync('experiments/out_config.json', 'utf8'));
const S = ['I am bored, and this is the scary bet I promised myself once a year.', 'I would keep living here and fly to Austin three days a week.', 'Launch weeks might be sixty hours, but only a few times a year.'];
for (const fb of [true, false]) for (let k = 0; k < 2; k++) await run(`Ablation caucusFeedback=${fb} run ${k + 1}`, job, 'Should I quit my job to join Lumen Labs as founding engineer?', S, { caucusFeedback: fb, skipLlm: true });
fs.writeFileSync('experiments/out_variety.txt', out.join('\n'));

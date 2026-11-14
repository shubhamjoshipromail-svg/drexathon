// P1 check: live NDI -> config -> engine; typed sentences, drift, vote. Usage: BASE=http://localhost:5174 node experiments/test_engine.mjs
import fs from 'node:fs';
import { readConstitution, readEvidence, buildConfig, createEngine } from '../public/engine.js';
const base = process.env.BASE || 'http://localhost:5173';
const t0 = performance.now();
const [c, e] = await Promise.all([readConstitution(base, fs.readFileSync('samples/constitution.pdf')), readEvidence(base, fs.readFileSync('samples/offer-letter.pdf'), 'offer-letter.pdf')]);
console.log(`NDI: constitution ${c.ms} ms, offer ${e.ms} ms; leader=`, JSON.stringify(c.result.data.leader));
const config = buildConfig(c.result, [{ result: e.result, doc: 'offer letter' }]);
fs.writeFileSync('experiments/out_config.json', JSON.stringify(config, null, 1));
const eng = createEngine({ base, config, decision: 'Should I quit my job to join Lumen Labs as founding engineer?' });
eng.on('drex', d => console.log(`  drex ${d.n}q ${d.ms}ms (eval ${d.evalMs})`));
eng.on('interrupt', x => console.log(`  >> ${x.short} (p=${x.interruptP.toFixed(2)}): ${x.line}`));
eng.on('accepted', x => console.log(`  ++ accepted: ${x.text} (${x.from})`));
const show = s => console.log(`#${s.i} "${s.text}"\n  ` + eng.state.ministers.map(m => `${m.short}:${m.stance.toFixed(1)}${m.lastCite ? '[' + (m.lastCite.id || '') + ']' : ''}${m.condition ? '{c}' : ''}`).join(' ') + `  caucus=${s.caucusMean}`);
show(await eng.start());
console.log('conditions:', JSON.stringify(eng.state.ministers.map(m => [m.short, m.conditions])));
for (const t of ['I am bored at my job and this is exactly the scary bet I promised myself once a year.',
  'Honestly I would sleep five hours a night for a year if that is what it takes.',
  'I would keep living here with Sam and only fly to Austin three days a week.',
  'Fine, I agree: I will keep my emergency fund at $27,000 no matter what.']) show(await eng.sentence(t));
const d = await eng.driftTick(); console.log('drift moved', d.filter(x => Math.abs(x.d) > 0.05).length, 'of 50');
await new Promise(r => setTimeout(r, 4000));
const v = await eng.vote();
console.log('VERDICT', JSON.stringify({ passed: v.passed, share: v.share.toFixed(2), threshold: v.threshold, reason: v.thresholdReason, votes: v.votes.map(x => `${x.short}:${x.vote}`), scope: v.votes.filter(x => x.inScopeP != null).map(x => `${x.short} inScope=${x.inScopeP.toFixed(2)}`), vetoes: v.vetoes.map(x => `${x.short} p=${x.inScopeP.toFixed(2)} allowed=${x.allowed}`), conditions: v.conditions.map(x => x.text) }));
if (v.vetoes.length) { const o = await eng.vote({ override: true }); console.log('OVERRIDE', o.passed, o.overridden, o.blocking); }
console.log('total', Math.round(performance.now() - t0), 'ms; interrupts', eng.state.interrupts.length);

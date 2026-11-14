// P0 gate 3: ~150 caucus `support` questions in ONE Drex request. Pass = < ~2 s and variants split.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const MIN = [
  ['Finance', 'savings and financial security', 'Emergency fund never below 6 months of expenses ($27,000).'],
  ['Health', 'sleep, body and mental health', 'Sleep at least 7 hours; never work more than 55 hours a week.'],
  ['Family', 'time with partner Sam and parents', 'Sundays belong to family. Veto over moving to another city.'],
  ['Ambition', 'career growth and impact', 'In my thirties choose the job where I learn fastest, not the one that pays most.'],
  ['Adventure', 'curiosity, novelty and joy', 'Once a year take one bet that scares me.'],
  ['Future Self', 'who I will be in ten years', 'Never join a company with less than 12 months of runway.'],
];
const TEMPER = ['cautious', 'bold', 'pragmatic', 'idealistic', 'anxious'];
const LENS = ['thinks about this month', 'thinks about the next year', 'thinks about the next decade', 'remembers past mistakes', 'cares what friends will think'];
const LEVELS = ['strongly against', 'against', 'undecided', 'for', 'strongly for'];
const members = MIN.flatMap(([m, mandate, rule]) => TEMPER.flatMap(t => LENS.map(l => ({ m, mandate, rule, t, l }))));
const questions = Object.fromEntries(members.map((x, i) => [`s${i}`, { type: 'score', criteria: LEVELS,
  instructions: `You are a ${x.t} member of the Ministry of ${x.m}'s caucus (protects ${x.mandate}) who ${x.l}. Your ministry's rule: ${x.rule} Given everything so far, how much do you support the decision?` }]));
const STATE = `Decision before the cabinet: "Should I quit my job to join Lumen Labs as founding engineer?"
Offer facts (from offer letter): base salary $120,000; 0.75% options, 4-year vesting, 1-year cliff; hybrid in Austin, in office 3 days/week, $10,000 relocation stipend; 50-60 hour weeks common during launches; 14 months runway.
The leader just said: "%S"`;
const SENT = ['I am so bored at my current job, and this is the kind of bet I said I would take once a year.', 'Honestly I would sleep five hours a night for a year if that is what it takes, and Sam can visit Austin on weekends.'];
for (const s of SENT) {
  const t = performance.now();
  const r = await fetch('https://console.nace.ai/v1/systemone', { method: 'POST', headers: { Authorization: `Bearer ${env.NACE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'drex-v2.0', state: STATE.replace('%S', s), questions }) });
  const j = await r.json(); const ms = Math.round(performance.now() - t);
  if (r.status !== 200) { console.log('ERR', r.status, JSON.stringify(j).slice(0, 400)); continue; }
  const sc = members.map((_, i) => j.answers[`s${i}`].score);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => Math.sqrt(mean(a.map(v => (v - mean(a)) ** 2)));
  console.log(`\n"${s}"\n${members.length} questions, round trip ${ms} ms, eval ${j.evaluation_time_ms} ms, overall mean ${mean(sc).toFixed(2)} sd ${sd(sc).toFixed(2)}, distinct rounded ${new Set(sc.map(Math.round)).size}`);
  for (const [m] of MIN) {
    const v = members.map((x, i) => x.m === m ? sc[i] : null).filter(x => x != null);
    const byT = TEMPER.map(t => `${t}=${mean(members.map((x, i) => x.m === m && x.t === t ? sc[i] : null).filter(x => x != null)).toFixed(1)}`).join(' ');
    console.log(`  ${m.padEnd(12)} mean ${mean(v).toFixed(2)} sd ${sd(v).toFixed(2)} min ${Math.min(...v).toFixed(1)} max ${Math.max(...v).toFixed(1)} | ${byT}`);
  }
}

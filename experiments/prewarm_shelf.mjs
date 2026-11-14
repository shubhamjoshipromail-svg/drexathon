// Read every shelf constitution through NDI once (live) so the demo serves them from the labelled cache.
// Usage: BASE=http://localhost:5174 node experiments/prewarm_shelf.mjs [--fresh]
import fs from 'node:fs';
import { readConstitution, readConstitutionUrl, readConstitutionWiki, readEvidence, buildConfig, setNdiFresh } from '../public/engine.js';
import { SHELF } from '../public/shelf.js';
const base = process.env.BASE || 'http://localhost:5173';
if (process.argv.includes('--fresh')) setNdiFresh(true);
for (const s of SHELF) {
  try {
    const r = s.kind === 'pdf' ? await readConstitution(base, fs.readFileSync('.' + s.source), s.source.split('/').pop())
      : s.kind === 'wiki' ? await readConstitutionWiki(base, s.site, s.source) : await readConstitutionUrl(base, s.source);
    for (const ev of s.evidence || []) await readEvidence(base, fs.readFileSync('.' + ev), ev.split('/').pop());
    const c = buildConfig(r.result, []);
    console.log(`${s.name}: ${r.cached ? 'cached' : 'LIVE'} ${r.liveMs ?? r.ms} ms | bodies: ${c.ministries.map(m => `${m.short} w${m.vote_weight}${m.has_veto ? ' VETO' : ''}`).join('; ')} | rules ${c.rules.length} | default ${c.passage.default_threshold} | special ${(c.passage.special || []).map(x => x.threshold).join(',')}`);
  } catch (e) { console.log(`${s.name}: FAILED ${e.message.slice(0, 200)}`); }
}

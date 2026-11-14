// P0 gate 2: NDI extract both sample PDFs through the server route. Usage: node experiments/gate_ndi.mjs
import fs from 'node:fs';
import { CONSTITUTION_SCHEMA, EVIDENCE_SCHEMA } from '../public/schemas.js';
const go = async (file, schema) => {
  const t = performance.now();
  const r = await fetch((process.env.BASE || 'http://localhost:5173') + '/api/ndi/doc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.split('/').pop(), pdf_b64: fs.readFileSync(file).toString('base64'), schema }) });
  const j = await r.json();
  const ms = Math.round(performance.now() - t);
  fs.writeFileSync(`experiments/out_${file.split('/').pop()}.json`, JSON.stringify(j, null, 1));
  console.log(`== ${file} status=${r.status} ${ms}ms`);
  return j;
};
const [c, e] = await Promise.all([go('samples/constitution.pdf', CONSTITUTION_SCHEMA), go('samples/offer-letter.pdf', EVIDENCE_SCHEMA)]);
console.log(JSON.stringify(c).slice(0, 600));
console.log(JSON.stringify(e).slice(0, 600));

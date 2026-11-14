// Probe Drex Max image latency/accuracy and NDI extract on a URL PDF.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const H = { Authorization: `Bearer ${env.NACE_API_KEY}`, 'Content-Type': 'application/json' };
const dir = process.argv[2];

let ok = 0; const lat = [];
for (const name of process.argv[3] === 'ndi' ? [] : ['both_up', 'left_up', 'right_up', 'down']) {
  const b64 = fs.readFileSync(`${dir}/${name}.jpg`).toString('base64');
  const t = performance.now();
  const r = await fetch('https://console.nace.ai/v1/systemone', { method: 'POST', headers: H, body: JSON.stringify({
    model: 'drex-max-v1.1', images: [`data:image/jpeg;base64,${b64}`],
    state: 'Image 1 is a webcam frame of a player using their body as a game controller.',
    questions: { pose: { type: 'choice', instructions: 'Which arms does the stick figure in Image 1 have raised above its head (image-left / image-right)?', criteria: { both_up: 'Both arms raised', left_up: 'Only the arm on the left side of the image raised', right_up: 'Only the arm on the right side of the image raised', down: 'Both arms down' } } },
  }) });
  const j = await r.json(); const ms = Math.round(performance.now() - t); lat.push(ms);
  if (r.status !== 200) { console.log('IMG err', r.status, JSON.stringify(j).slice(0, 300)); continue; }
  const a = j.answers.pose; if (a.choice === name) ok++;
  console.log(`IMG ${name}: got ${a.choice} conf=${a.confidence.toFixed(2)} roundtrip=${ms}ms eval=${j.evaluation_time_ms}ms tokens=${j.usage.input_tokens}`);
}
console.log(`IMG accuracy ${ok}/4`);

// NDI extract straight from a URL
const t = performance.now();
const r = await fetch('https://console.nace.ai/v1/documents/extract?wait_seconds=60', { method: 'POST', headers: H, body: JSON.stringify({
  source: { type: 'url', url: 'https://arxiv.org/pdf/1706.03762', file_name: 'attention.pdf' },
  schema: { type: 'object', properties: {
    title: { type: 'string' }, num_encoder_layers: { type: 'number', description: 'N, number of identical encoder layers' },
    dropout_rate: { type: 'number', description: 'P_drop used for the base model' },
  } },
}) });
const j = await r.json();
console.log(`NDI extract status=${r.status} in ${Math.round(performance.now() - t)}ms`);
console.log(JSON.stringify(j).slice(0, 1800));

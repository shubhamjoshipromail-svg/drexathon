// Shout Command server: static files + API proxies (keys stay server-side). No deps; Node 22+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
function loadEnv() {
  try {
    // .env (Nace, OpenAI) + .env.local (ELEVENLABS_API_KEY, written by the ElevenLabs CLI)
    return Object.fromEntries(['.env', '.env.local'].flatMap(f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n'); } catch { return []; } })
      .filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
  } catch { return {}; }
}
const env = () => ({ ...loadEnv(), ...process.env });
const PORT = +(process.env.PORT || 5173);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.pdf': 'application/pdf' };

const readBody = req => new Promise((res, rej) => { let b = ''; req.on('data', c => b += c); req.on('end', () => res(b)); req.on('error', rej); });
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };

// Nace asks clients to back off on 403-challenge / 429 and respect retry-after (blocked requests are not billed).
async function fetchBackoff(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    const blocked = r.status === 429 || (r.status === 403 && r.headers.get('x-vercel-mitigated'));
    if (!blocked || i >= tries - 1) return r;
    const wait = Math.min(8, +(r.headers.get('retry-after') || 2)) * 1000 * (i + 1) / 2;
    console.warn(`upstream ${r.status} (${r.headers.get('x-vercel-mitigated') || 'rate'}) on ${url}; retry in ${wait} ms`);
    await new Promise(s => setTimeout(s, wait));
  }
}

async function proxy(res, url, headers, body) {
  const t = performance.now();
  try {
    const r = await fetchBackoff(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'X-Proxy-Ms': String(Math.round(performance.now() - t)) });
    res.end(text);
  } catch (e) { send(res, 502, { error: String(e) }); }
}

// Minimal text -> PDF (Helvetica, wrapped, multi-page). No deps.
function textToPdf(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').flatMap(l => { const out = []; let s = l; while (s.length > 92) { let k = s.lastIndexOf(' ', 92); if (k < 40) k = 92; out.push(s.slice(0, k)); s = s.slice(k).trimStart(); } out.push(s); return out; });
  const pages = []; for (let i = 0; i < lines.length; i += 56) pages.push(lines.slice(i, i + 56));
  const esc = s => s.replace(/[^\x20-\x7e]/g, c => ({ '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...' }[c] || ' ')).replace(/([\\()])/g, '\\$1');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const pg of pages) {
    const stream = 'BT /F1 11 Tf 14 TL 56 790 Td ' + pg.map(l => `(${esc(l)}) '`).join(' ') + ' ET';
    objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function ndiUploadExtract(raw, name, schema) {
  const H = { Authorization: `Bearer ${env().NACE_API_KEY}` };
  const p = `cabinet/${Date.now()}-${name.replace(/[^\w.-]/g, '_')}`;
  const gr = await fetchBackoff('https://console.nace.ai/v1/documents/upload-grants', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p, ttl_seconds: 600 }) });
  const gt = await gr.text(); let grant;
  try { grant = JSON.parse(gt); } catch { throw new Error(`NDI upload-grant HTTP ${gr.status}: ${/Security Checkpoint/.test(gt) ? 'Nace API is behind a Vercel security checkpoint right now; wait and retry' : gt.slice(0, 120)}`); }
  if (!grant.upload_url) throw Object.assign(new Error('grant failed'), { detail: grant });
  const fd = new FormData();
  fd.append('file', new Blob([raw], { type: 'application/pdf' }), name);
  fd.append('metadata', JSON.stringify({ path: p }));
  const up = await (await fetch(grant.upload_url, { method: 'POST', headers: { 'X-Upload-Token': grant.token }, body: fd })).json();
  const file = up.result?.file || up.file;
  if (!file?.file_id) throw Object.assign(new Error('upload failed'), { detail: up });
  return (await fetch('https://console.nace.ai/v1/documents/extract?wait_seconds=120', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({
    source: { type: 'workspace_file', workspace_id: file.workspace_id ?? grant.workspace_id, file_id: file.file_id }, schema }) })).json();
}

const routes = {
  // Drex System One. Body: {model?, state, questions, images?}
  '/api/drex': (req, res, body) => {
    const j = JSON.parse(body); j.model ||= 'drex-v2.0';
    return proxy(res, 'https://console.nace.ai/v1/systemone', { Authorization: `Bearer ${env().NACE_API_KEY}` }, JSON.stringify(j));
  },
  // NDI extract. Body: {source, schema}
  '/api/ndi/extract': (req, res, body) =>
    proxy(res, 'https://console.nace.ai/v1/documents/extract?wait_seconds=90', { Authorization: `Bearer ${env().NACE_API_KEY}` }, body),
  // Generic: {pdf_b64, name, schema} -> NDI upload -> extract (with citations). Used by The Cabinet.
  '/api/ndi/doc': async (req, res, body) => {
    const j = JSON.parse(body);
    const t0 = performance.now();
    try { send(res, 200, { ms: Math.round(performance.now() - t0), extract: await ndiUploadExtract(Buffer.from(j.pdf_b64, 'base64'), j.name || 'doc.pdf', j.schema), ms_total: Math.round(performance.now() - t0) }); }
    catch (e) { send(res, 502, { error: String(e.message || e), detail: e.detail }); }
  },
  // Field manual (archived Shout Command): raw PDF bytes in -> NDI upload -> extract doctrine rules with page citations.
  '/api/ndi/manual': async (req, res, _b, raw) => {
    const KEY = env().NACE_API_KEY, H = { Authorization: `Bearer ${KEY}` };
    const t0 = performance.now();
    const p = `manuals/${Date.now()}-field-manual.pdf`;
    const grant = await (await fetch('https://console.nace.ai/v1/documents/upload-grants', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p, ttl_seconds: 600 }) })).json();
    if (!grant.upload_url) return send(res, 502, { step: 'grant', grant });
    const fd = new FormData();
    fd.append('file', new Blob([raw], { type: 'application/pdf' }), 'field-manual.pdf');
    fd.append('metadata', JSON.stringify({ path: p }));
    const up = await (await fetch(grant.upload_url, { method: 'POST', headers: { 'X-Upload-Token': grant.token }, body: fd })).json();
    const file = up.result?.file || up.file;
    if (!file?.file_id) return send(res, 502, { step: 'upload', up });
    const ex = await (await fetch('https://console.nace.ai/v1/documents/extract?wait_seconds=120', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({
      source: { type: 'workspace_file', workspace_id: file.workspace_id ?? grant.workspace_id, file_id: file.file_id },
      schema: { type: 'object', properties: { rules: { type: 'array', description: 'Every numbered standing doctrine rule (e.g. Rule 2.1) that creatures must obey. Skip history, descriptions and signals.', items: { type: 'object', properties: {
        number: { type: 'string', description: 'Rule number, e.g. 2.1' },
        rule: { type: 'string', description: 'The rule, restated as one clear imperative sentence' },
        applies_to: { type: 'string', description: 'Which creature types it applies to: biters, spitters, darters, menders, or all' },
      } } } } },
    }) })).json();
    send(res, 200, { ms: Math.round(performance.now() - t0), extract: ex });
  },
  // ElevenLabs text-to-speech (live, per line). Body: {text, voice_id}. Returns audio/mpeg.
  '/api/tts': async (req, res, body) => {
    const { text, voice_id } = JSON.parse(body); const e2 = env(); const key = e2.ELEVENLABS_API_KEY;
    if (!key) return send(res, 503, { error: 'no ELEVENLABS_API_KEY' });
    const t = performance.now();
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id || 'JBFqnCBsd6RMkjVDRZzb')}?output_format=mp3_44100_128`, { method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: e2.ELEVENLABS_MODEL || 'eleven_v4', voice_settings: { stability: 0.45, similarity_boost: 0.8 } }) });
    if (!r.ok) return send(res, r.status, { error: `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}` });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'X-Proxy-Ms': String(Math.round(performance.now() - t)) }); res.end(buf);
  },
  // LLM: DeepInfra (partner, Qwen) first; OpenAI as backup if DeepInfra is missing or fails.
  // Response gets `provider` + `model` so the UI can say who wrote each line. <think> blocks are stripped.
  '/api/llm': async (req, res, body) => {
    const e = env(); const j = JSON.parse(body); const errs = [];
    const providers = [
      e.DEEPINFRA_API_KEY && { provider: 'DeepInfra', url: 'https://api.deepinfra.com/v1/openai/chat/completions', key: e.DEEPINFRA_API_KEY, model: e.DEEPINFRA_MODEL || 'Qwen/Qwen3.8-27B' },
      e.OPENAI_API_KEY && { provider: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', key: e.OPENAI_API_KEY, model: e.OPENAI_MODEL || 'gpt-6-luna' },
    ].filter(Boolean);
    for (const p of providers) {
      const t = performance.now();
      try {
        const r = await fetch(p.url, { method: 'POST', headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: p.model, messages: j.messages, ...(p.provider === 'DeepInfra' ? { chat_template_kwargs: { enable_thinking: false } } : {}) }) });
        const out = await r.json();
        if (!r.ok || !out.choices?.[0]) { errs.push(`${p.provider} ${r.status}: ${JSON.stringify(out).slice(0, 150)}`); continue; }
        out.choices[0].message.content = String(out.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        return send(res, 200, { ...out, provider: p.provider, model: p.model, ms: Math.round(performance.now() - t), fellBack: errs.length ? errs : undefined });
      } catch (err) { errs.push(`${p.provider}: ${err.message}`); }
    }
    send(res, 502, { error: 'no LLM answered', errs });
  },
  // NDI on text the user wrote/pasted: render it to a plain PDF here, then NDI reads it like any document.
  '/api/ndi/text': async (req, res, body) => {
    const j = JSON.parse(body); const t0 = performance.now();
    try { send(res, 200, { extract: await ndiUploadExtract(textToPdf(j.text), j.name || 'text.pdf', j.schema), ms_total: Math.round(performance.now() - t0) }); }
    catch (e) { send(res, 502, { error: String(e.message || e), detail: e.detail }); }
  },
  // NDI on a web link (job post, listing, article, public doc).
  '/api/ndi/url': async (req, res, body) => {
    const j = JSON.parse(body); const t0 = performance.now();
    const name = (new URL(j.url).pathname.split('/').filter(Boolean).pop() || new URL(j.url).hostname).replace(/[^\w.-]/g, '_').slice(0, 60) + (/\.\w{2,4}$/.test(j.url) ? '' : '.html');
    const r = await fetchBackoff('https://console.nace.ai/v1/documents/extract?wait_seconds=120', { method: 'POST', headers: { Authorization: `Bearer ${env().NACE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { type: 'url', url: j.url, file_name: name }, schema: j.schema }) });
    const text = await r.text();
    try { send(res, r.status, { extract: JSON.parse(text), ms_total: Math.round(performance.now() - t0) }); }
    catch { send(res, 502, { error: `NDI url HTTP ${r.status}: ${text.slice(0, 120)}` }); }
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && routes[url.pathname]) {
    try {
          if (url.pathname === '/api/ndi/manual') { const chunks = []; for await (const c of req) chunks.push(c); return await routes[url.pathname](req, res, '', Buffer.concat(chunks)); }
      return await routes[url.pathname](req, res, await readBody(req));
    } catch (e) { return send(res, 500, { error: String(e) }); }
  }
  if (url.pathname === '/api/status') {
    const e = env();
    return send(res, 200, { drex: !!e.NACE_API_KEY, llm: !!e.OPENAI_API_KEY, llmModel: e.DEEPINFRA_API_KEY ? (e.DEEPINFRA_MODEL || 'Qwen/Qwen3.8-27B') + ' (DeepInfra; OpenAI backup)' : e.OPENAI_MODEL || 'gpt-6-luna', tts: !!e.ELEVENLABS_API_KEY });
  }
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  if (p === '/archive/shout-command' ) { res.writeHead(302, { Location: '/archive/shout-command/' }); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  // /archive/* and /samples/* served from the repo; everything else from public/
  const base = /^\/(archive|samples)\//.test(p) ? ROOT : path.join(ROOT, 'public');
  const file = path.join(base, p);
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`The Cabinet on http://localhost:${PORT} (fallback game: /archive/shout-command/)`));

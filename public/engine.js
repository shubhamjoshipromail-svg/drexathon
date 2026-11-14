// The Cabinet engine. Every decision comes from a live Drex call; authority (weights, vetoes, thresholds,
// override) is applied here in code. The LLM only writes candidate conditions (setup) and spoken lines.
// Works in the browser (base '') and in Node (base 'http://localhost:5174').
import { CONSTITUTION_SCHEMA, EVIDENCE_SCHEMA } from './schemas.js';

export const LEVELS = ['strongly against', 'against', 'undecided', 'for', 'strongly for'];
export const FACES = { excited: 'Excited, energised, smiling or animated', anxious: 'Anxious, worried, tense or stressed', unsure: 'Unsure, hesitant, doubtful or confused', determined: 'Determined, resolute, serious and focused', neutral: 'Neutral, calm, no strong expression' };
const TEMPER = ['cautious', 'bold', 'pragmatic', 'idealistic', 'anxious'];
const LENS = ['thinks about this month', 'thinks about the next year', 'thinks about the next decade', 'remembers past mistakes', 'cares what friends will think'];
// A personal stake per caucus member, so members of one ministry weigh the same facts differently.
const STAKES = ['carries the memory of a friend whose startup failed', 'is quietly burned out by the current routine', 'remembers being broke at 24', 'has always wanted to build something of their own',
  'worries about aging parents who may need help', 'loves the people on the current team', 'feels life is passing by too safely', 'values a predictable paycheck above all',
  'trusts gut feelings more than spreadsheets', 'has seen bold bets pay off before', 'fears regret more than failure', 'hates uncertainty and open-ended risk', 'thinks money problems ruin relationships'];
const persona = c => `You are a ${c.temper} member of the Ministry of %M's caucus who ${c.lens} and ${c.stake}. Judge from YOUR own temperament and stake; members of the same ministry often disagree.`;
const FRAC = { simple: 0.5, three_fifths: 0.6, two_thirds: 2 / 3, unanimous: 1 };
const RANK = { none: -1, simple: 0, three_fifths: 1, two_thirds: 2, unanimous: 3 };
const label = s => LEVELS[Math.max(0, Math.min(4, Math.round(s)))];
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
// ElevenLabs premade voices (from this account's /v1/voices list), matched to each ministry's character.
const VOICES = { finance: 'onwK4e9ZLuTAKqWW03F9' /* Daniel, formal */, health: 'Xb7hH8MSUJpSbSDYk0k2' /* Alice, calm */, family: 'pFZP5JQG7iQjIQuC4Bku' /* Lily, warm */,
  ambition: 'pNInz6obpgDQGcFmaJgB' /* Adam, firm */, adventure: 'IKne3meq5aSn9XLyUdCD' /* Charlie, energetic */, 'future self': 'pqHfZKP75CvOlQylNhV4' /* Bill, old + wise */ };
const SPARE_VOICES = ['JBFqnCBsd6RMkjVDRZzb', 'XrExE9yKIg1WjnnlVkGX', 'cjVigY5qzO86Huf0OWal', 'nPczCjzI2devNBz1zQrb'];
// Live speech: fetch an mp3 for this line from ElevenLabs via the server and play it. Resolves when playback ends.
// onAudio(audioEl) is called before playback starts, so the UI can attach an AnalyserNode for talking animation.
export async function speakLine(base, text, voiceId, onAudio) {
  const r = await fetch(base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice_id: voiceId }) });
  if (!r.ok) throw new Error('Voice: ' + (await r.text()).slice(0, 200));
  const url = URL.createObjectURL(await r.blob()); const audio = new Audio(url); onAudio?.(audio);
  await new Promise((res, rej) => { audio.onended = res; audio.onerror = () => rej(new Error('Voice playback failed')); audio.play().catch(rej); });
  URL.revokeObjectURL(url);
}
export const shortName = n => n.replace(/^(the\s+)?(ministry|department|office|minister)\s+(of|for)\s+(the\s+)?/i, '');

// Parse a proxy response; name upstream HTML blocks (e.g. Vercel security checkpoint) instead of a JSON error.
export async function readJson(r, what) {
  const text = await r.text();
  try { return JSON.parse(text); } catch {
    const blocked = /Security Checkpoint|vercel/i.test(text) ? ' (Nace API is behind a Vercel security checkpoint right now; wait and retry)' : '';
    throw new Error(`${what}: HTTP ${r.status}, non-JSON response${blocked}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120)}`);
  }
}

// ---------- NDI ----------
// Cached NDI reads are returned instantly with cached:true/cachedAt; setNdiFresh(true) forces live reads.
let NDI_FRESH = false;
export const setNdiFresh = v => { NDI_FRESH = !!v; };
const b64 = async bytes => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  const u = new Uint8Array(bytes); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s);
};
export async function ndiExtract(base, bytes, name, schema) {
  const t = performance.now();
  const r = await fetch(base + '/api/ndi/doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, schema, pdf_b64: await b64(bytes), fresh: NDI_FRESH }) });
  const j = await readJson(r, 'NDI');
  if (r.status !== 200 || j.extract?.status !== 'succeeded') throw new Error('NDI failed: ' + JSON.stringify(j).slice(0, 300));
  return { ms: Math.round(performance.now() - t), result: j.extract.result, cached: !!j.cached, cachedAt: j.cachedAt || null, liveMs: j.liveMs };
}
// Pull page + quoted source text for /<arr>/<i> out of NDI field citations.
const citeOf = (result, p) => { const f = result.fields?.find(x => x.path === p); const c = f?.citations?.[0]; return c ? { page: c.location?.page, quote: c.source_text } : { page: null, quote: null }; };
// Text the user wrote / pasted (server renders it to PDF, NDI reads it) and web links (NDI reads the page).
async function ndiPost(base, route, body, label) {
  const t = performance.now();
  const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, fresh: NDI_FRESH }) });
  const j = await readJson(r, 'NDI');
  if (r.status !== 200 || j.extract?.status !== 'succeeded') throw new Error(`NDI failed on ${label}: ` + JSON.stringify(j.error || j.extract?.error || j).slice(0, 300));
  return { ms: Math.round(performance.now() - t), result: j.extract.result, cached: !!j.cached, cachedAt: j.cachedAt || null, liveMs: j.liveMs };
}
export const readConstitutionText = (base, text, name = 'my-constitution.pdf') => ndiPost(base, '/api/ndi/text', { text, name, schema: CONSTITUTION_SCHEMA }, name);
export const readEvidenceText = (base, text, name = 'pasted-text.pdf') => ndiPost(base, '/api/ndi/text', { text, name, schema: EVIDENCE_SCHEMA }, name);
export const readConstitutionWiki = (base, site, title) => ndiPost(base, '/api/ndi/wiki', { site, title, schema: CONSTITUTION_SCHEMA }, `${site}/${title}`);
export const readConstitutionUrl = (base, url) => ndiPost(base, '/api/ndi/url', { url, schema: CONSTITUTION_SCHEMA }, url);
export const readEvidenceUrl = (base, url) => ndiPost(base, '/api/ndi/url', { url, schema: EVIDENCE_SCHEMA }, url);
export const readConstitution = (base, bytes, name = 'constitution.pdf') => ndiExtract(base, bytes, name, CONSTITUTION_SCHEMA);
export const readEvidence = (base, bytes, name = 'evidence.pdf') => ndiExtract(base, bytes, name, EVIDENCE_SCHEMA);

// NDI results -> config (code, no model).
export function buildConfig(constResult, evidenceResults = []) {
  const d = constResult.data;
  const ministries = (d.ministries || []).map((m, i) => ({ ...m, id: `m${i}`, short: shortName(m.name), cite: citeOf(constResult, `/ministries/${i}`) }));
  const rules = (d.rules || []).map((r, i) => ({ ...r, cite: citeOf(constResult, `/rules/${i}`) }));
  const facts = evidenceResults.flatMap(({ result, doc }) => (result.data.facts || []).map((f, i) => ({ ...f, doc, cite: citeOf(result, `/facts/${i}`) })));
  return { ministries, rules, facts, passage: d.passage || { default_threshold: 'simple', special: [] }, leader: d.leader || { can_override_veto: false },
    leaderCite: citeOf(constResult, '/leader'), passageCite: citeOf(constResult, '/passage/default_threshold') };
}

const rulesFor = (cfg, m) => cfg.rules.filter(r => { const a = (r.applies_to || '').toLowerCase(); return a === 'all' || a.includes(m.short.toLowerCase()) || m.name.toLowerCase().includes(a); });

// Hemicycle seats: unit semicircle (x -1..1, y 0..1), ministries in contiguous angular sectors.
function seats(n) {
  const rows = 6, radii = Array.from({ length: rows }, (_, r) => 0.45 + r * 0.11), tot = radii.reduce((a, b) => a + b, 0);
  const pts = []; let left = n;
  radii.forEach((rad, r) => { const k = r === rows - 1 ? left : Math.round(n * rad / tot); left -= k;
    for (let i = 0; i < k; i++) { const th = Math.PI * (1 - (i + 0.5) / k); pts.push({ x: Math.cos(th) * rad, y: Math.sin(th) * rad, th }); } });
  return pts.sort((a, b) => b.th - a.th);
}

// Setup gate: is the motion something a chamber can vote for or against? (Drex decides, ~0.2 s)
export async function checkMotion(base, decision) {
  const r = await fetch(base + '/api/drex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: `Proposed motion: "${decision}"`,
    questions: { votable: { type: 'noul', instructions: 'Is this a concrete yes/no decision or proposal that a person could vote for or against (e.g. "Should I take the job?"), rather than an open question like "What is the point of life?"' } } }) });
  const j = await readJson(r, 'Drex'); if (r.status !== 200) throw new Error('Drex ' + r.status + ': ' + JSON.stringify(j).slice(0, 200));
  const p = j.answers.votable.noul ?? j.answers.votable.confidence;
  return { ok: p >= 0.5, p };
}

// ---------- Engine ----------
export function createEngine({ base = '', config, decision, caucusFeedback = true, caucusSize = 150, drexModel = 'drex-v2.0', faceModel = 'drex-max-v1.1' }) {
  const listeners = {};
  const emit = (type, data) => (listeners[type] || []).forEach(f => { try { f(data); } catch (e) { console.error(e); } });
  if (!config.ministries?.length) throw new Error('NDI found no voting bodies (ministries/branches) in this constitution, so there is no Senate to convene. Try a document that says who decides and how.');
  const S = { decision, config, ministers: [], members: [], sentences: [], faces: [], accepted: [], drexLog: [], busy: false, verdict: null, interrupts: [], questions: [], openQuestion: null, llmLog: [] };

  // Agents (code, no LLM)
  S.ministers = config.ministries.map(m => ({ id: m.id, name: m.name, short: m.short, mandate: m.mandate, weight: +m.vote_weight || 1, veto: !!m.has_veto, vetoScope: m.veto_scope || '',
    cite: m.cite, rules: rulesFor(config, m), voice: VOICES[m.short.toLowerCase()] || SPARE_VOICES[(+m.id.slice(1)) % SPARE_VOICES.length], questions: [], asked: [], stance: 2, stanceP: null, vote: null, condition: null, conditions: [], ally: null, interruptP: 0, lastCite: null, lastInterrupt: -9, history: [] }));
  const per = Math.max(1, Math.round(caucusSize / S.ministers.length));
  const combos = TEMPER.flatMap(t => LENS.map(l => ({ t, l })));
  const pts = seats(per * S.ministers.length);
  S.ministers.forEach((mi, k) => { for (let j = 0; j < per; j++) { const c = combos[(j * 7) % combos.length]; const stake = STAKES[(j * 5 + k * 3) % STAKES.length];
    S.members.push({ id: `c${S.members.length}`, ministry: mi.id, temper: c.t, lens: c.l, stake, traits: `${c.t}, ${c.l}, ${stake}`, seat: pts[S.members.length], support: 2 }); } });
  S.members.forEach(m => { m.neighbours = S.members.map(o => [o, (o.seat.x - m.seat.x) ** 2 + (o.seat.y - m.seat.y) ** 2]).sort((a, b) => a[1] - b[1]).slice(1, 7).map(x => x[0]); });
  const minOf = id => S.ministers.find(m => m.id === id);

  async function drex(questions, state, model = drexModel, images) {
    const t = performance.now();
    const r = await fetch(base + '/api/drex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, state, questions, ...(images ? { images } : {}) }) });
    const j = await readJson(r, 'Drex'); const ms = Math.round(performance.now() - t);
    if (r.status !== 200) throw new Error(`Drex ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    const entry = { n: Object.keys(questions).length, ms, evalMs: Math.round(j.evaluation_time_ms || 0), model, t: Date.now() }; S.drexLog.push(entry); emit('drex', entry);
    return j.answers;
  }
  async function llm(messages) {
    const r = await fetch(base + '/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
    const j = await readJson(r, 'LLM'); if (r.status !== 200) throw new Error('LLM ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    const entry = { provider: j.provider, model: j.model, ms: j.ms, fellBack: j.fellBack || null, t: Date.now() }; S.llmLog.push(entry); emit('llm', entry);
    return j.choices[0].message.content.trim();
  }

  const factsText = () => config.facts.map((f, i) => `[F${i}] ${f.fact} (${f.doc} p${f.cite.page})`).join('\n');
  const stateText = (extra = '') => [
    `Decision before the leader's personal cabinet: "${S.decision}"`,
    config.facts.length ? `Evidence (read from the leader's documents):\n${factsText()}` : '',
    S.sentences.length ? `What the leader has said so far (oldest first):\n${S.sentences.slice(-8).map(s => `- "${s.text}"${s.face ? ` (looked ${s.face.label} while saying it)` : ''}`).join('\n')}` : '',
    `Current minister positions: ${S.ministers.map(m => `${m.short}: ${label(m.stance)}`).join('; ')}`,
    S.accepted.length ? `Conditions the leader has accepted: ${S.accepted.map(c => `"${c.text}" (from ${c.from})`).join('; ')}` : '',
    // Floor speeches enter context as structured positions only (never the LLM's words).
    S.openQuestion ? `The Senate's open question to the leader (from ${S.openQuestion.short}): "${S.openQuestion.text}". The leader's next sentence may answer it.` : '',
    S.questions.filter(q => q.answer).length ? `Questions the leader has answered: ${S.questions.filter(q => q.answer).map(q => `${q.short} asked "${q.text}"; leader said "${q.answer}"`).join('; ')}` : '',
    S.interrupts.filter(x => x.kind !== 'question').length ? `Recent floor interventions: ${S.interrupts.filter(x => x.kind !== 'question').slice(-3).map(x => `${x.short} (${label(x.stance)}) raised ${x.cite ? (x.cite.kind === 'rule' ? `Rule ${x.cite.id}` : `"${x.cite.fact}"`) : 'its mandate'}${x.condition ? ` and demanded "${x.condition}"` : ''}`).join('; ')}` : '',
    extra].filter(Boolean).join('\n\n');
  // The swarm feeds back: each senator sees how its own caucus currently leans (before this sentence).
  const caucusOf = m => { const v = S.members.filter(c => c.ministry === m.id).map(c => c.support);
    return { n: v.length, against: v.filter(x => x < 1.5).length, for: v.filter(x => x > 2.5).length, mean: mean(v) }; };
  const caucusLine = m => { if (!S.sentences.length || !caucusFeedback) return ''; const c = caucusOf(m);
    return `\nYour caucus right now: ${c.against} of ${c.n} members lean against, ${c.for} lean for (mean ${label(c.mean)}). You answer to them, but you may disagree with them if your rules require it.`; };
  // For drafting conditions: only the ministry's OWN rules (shared 'all' rules made every senator demand the same thing).
  const ownBrief = m => `Ministry of ${m.short}. Mandate: ${m.mandate}${m.veto ? ` Veto over: ${m.vetoScope}.` : ''} Own rules: ${m.rules.filter(r => (r.applies_to || '').toLowerCase() !== 'all').map(r => `Rule ${r.id}: ${r.text}`).join(' ') || 'none (use its mandate)'}`;
  const ministerBrief = m => `You are the Ministry of ${m.short} in the leader's personal cabinet. Your mandate: ${m.mandate}${m.veto ? ` You hold a veto over: ${m.vetoScope}.` : ''} Your rules: ${m.rules.map(r => `Rule ${r.id}: ${r.text}`).join(' ') || 'none'}`;

  // Setup: from THIS constitution + evidence + decision, the LLM drafts per ministry 3 candidate conditions and
  // 2 questions about information the documents do not give. Drex later decides live whether/which to use.
  async function draftConditions() {
    const txt = await llm([{ role: 'system', content: 'You draft options for a personal decision cabinet. Reply with JSON only.' },
      { role: 'user', content: `Decision: "${S.decision}"\nEvidence:\n${factsText() || '(none)'}\n\nFor each ministry below write (a) 3 short, concrete conditions (max 14 words) it could demand before agreeing, grounded in ITS OWN rules and the evidence (not rules that apply to all ministries; no two ministries may share a condition), and (b) 2 short questions (max 14 words) it would ask the leader to learn something its rules need that the evidence does NOT say. Reply as JSON {"<ministry id>": {"conditions": ["..."], "questions": ["..."]}}.\n${S.ministers.map(m => `${m.id}: ${ownBrief(m)}`).join('\n')}` }]);
    let j; const parse = t => { const s = t.replace(/```(json)?/g, '').replace(/[\u0000-\u001f]+/g, ' '); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); };
    try { j = parse(txt); } catch {   // one retry: the LLM sometimes returns broken JSON
      const t2 = await llm([{ role: 'system', content: 'Return valid JSON only.' }, { role: 'user', content: `Fix this into valid JSON, same content:\n${txt}` }]); j = parse(t2); }
    S.ministers.forEach(m => { const x = j[m.id] || {}; m.conditions = (Array.isArray(x) ? x : x.conditions || []).slice(0, 3); m.questions = (x.questions || []).slice(0, 2); });
    emit('conditions', S.ministers.map(m => ({ id: m.id, conditions: m.conditions, questions: m.questions })));
  }

  async function readFace(frame) {
    const a = await drex({ face: { type: 'choice', instructions: 'Which best describes the facial expression and body language of the person in Image 1? If no person is visible, answer neutral.', criteria: FACES } },
      'Image 1 is a webcam frame of a person arguing out loud about a big life decision.', faceModel, [frame]);
    const f = { label: a.face.choice, conf: a.face.confidence, probs: a.face.probabilities || null, t: Date.now() };
    S.faces.push(f); emit('face', f); return f;
  }

  // One sentence: (face) -> ministers call || caucus call. Two packed Drex requests.
  async function sentence(text, { frame } = {}) {
    while (S.busy) await new Promise(r => setTimeout(r, 50));
    S.busy = true;
    try {
      const sen = { i: S.sentences.length, text, t: Date.now(), face: null };
      if (frame) { try { sen.face = await readFace(frame); } catch (e) { emit('error', 'Face reading failed: ' + e.message); } }
      S.sentences.push(sen);
      try {
      const open = S.ministers.filter(m => m.condition && !S.accepted.some(c => c.text === m.condition)).map(m => ({ text: m.condition, from: m.short, id: m.id }));
      const q = {};
      const citeKeys = {};
      for (const m of S.ministers) {
        const brief = ministerBrief(m) + caucusLine(m);
        q[`${m.id}_stance`] = { type: 'score', criteria: LEVELS, instructions: `${brief}\nJudging only by your mandate and rules, after the leader's latest sentence, where do you stand on the decision?` };
        q[`${m.id}_interrupt`] = { type: 'noul', instructions: `${brief}\nDid the leader's latest sentence touch your mandate or rules so directly that you must speak up right now?` };
        const ck = { none: 'Nothing specific' }; m.rules.forEach(r => { ck[`r${r.id}`] = `Rule ${r.id}: ${r.text}`; }); config.facts.forEach((f, i) => { ck[`f${i}`] = f.fact; });
        citeKeys[m.id] = ck;
        q[`${m.id}_cite`] = { type: 'choice', criteria: ck, instructions: `${brief}\nWhich single rule or evidence fact best supports your position on the leader's latest sentence?` };
        const unasked = m.questions.filter(x => !m.asked.includes(x));
        if (unasked.length && !S.openQuestion) q[`${m.id}_ask`] = { type: 'choice', criteria: { none: 'No question needed now', ...Object.fromEntries(unasked.map(x => [`k${m.questions.indexOf(x)}`, x])) }, instructions: `${brief}\nIs there a question you must ask the leader right now, because you cannot judge the decision without that information and nothing said or written so far answers it?` };
        if (m.conditions.length) q[`${m.id}_condition`] = { type: 'choice', criteria: { none: 'No condition needed now', ...Object.fromEntries(m.conditions.map((c, i) => [`k${i}`, c])) }, instructions: `${brief}\nWhich condition, if any, would you demand from the leader now?` };
        const others = S.ministers.filter(o => o !== m);
        q[`${m.id}_ally`] = { type: 'choice', criteria: { none: 'No natural ally right now', ...Object.fromEntries(others.map(o => [o.id, `Ministry of ${o.short} (${o.mandate})`])) }, instructions: `${brief}\nWhich other ministry is closest to your position right now?` };
      }
      if (open.length) q.accept = { type: 'choice', criteria: { none: 'The latest sentence accepts none of these', ...Object.fromEntries(open.map((c, i) => [`o${i}`, c.text])) }, instructions: 'Does the leader\'s latest sentence explicitly accept or commit to one of these conditions?' };
      const before = S.ministers.map(m => m.stance);
      const cq = Object.fromEntries(S.members.map(c => [c.id, { type: 'score', criteria: LEVELS,
        instructions: `${persona(c).replace('%M', minOf(c.ministry).short)} Your ministry protects ${minOf(c.ministry).mandate} Its rules: ${minOf(c.ministry).rules.map(r => r.text).join(' ')} Given everything, how much do you support the decision now?` }]));
      const st = stateText(`The leader's latest sentence: "${text}"${sen.face ? ` (looked ${sen.face.label} while saying it)` : ''}`);
      const [a, ca] = await Promise.all([drex(q, st), drex(cq, st)]);
      S.ministers.forEach((m, k) => {
        m.stance = a[`${m.id}_stance`].score; m.stanceP = a[`${m.id}_stance`].probabilities || null;
        m.interruptP = a[`${m.id}_interrupt`].noul ?? a[`${m.id}_interrupt`].confidence;
        const ci = a[`${m.id}_cite`].choice; m.lastCite = ci === 'none' ? null : ci[0] === 'r' ? { kind: 'rule', ...m.rules.find(r => `r${r.id}` === ci) } : { kind: 'fact', ...config.facts[+ci.slice(1)] };
        const co = a[`${m.id}_condition`]?.choice; m.condition = co && co !== 'none' ? m.conditions[+co.slice(1)] : m.condition;
        const al = a[`${m.id}_ally`].choice; m.ally = al === 'none' ? null : al;
        m.history.push({ i: sen.i, stance: m.stance, cite: m.lastCite, interruptP: m.interruptP });
      });
      if (q.accept && a.accept.choice !== 'none') { const c = open[+a.accept.choice.slice(1)]; S.accepted.push({ ...c, at: sen.i, p: a.accept.confidence }); emit('accepted', c); }
      S.members.forEach(c => { c.support = ca[c.id].score; (c.history ||= []).push({ at: sen.i, src: 'sentence', support: c.support, t: Date.now() }); });
      // Acta: exact context, questions and raw Drex answers for this sentence (audit trail).
      sen.acta = { state: st, q, a, cq, ca };
      // The open question (if any) is answered by this sentence.
      if (S.openQuestion && sen.i > S.openQuestion.at) { S.openQuestion.answer = text; S.openQuestion.answeredAt = sen.i; S.openQuestion = null; }
      sen.ministerDeltas = Object.fromEntries(S.ministers.map((m, k) => [m.id, +(m.stance - before[k]).toFixed(2)]));
      sen.caucusMeanByMinistry = Object.fromEntries(S.ministers.map(m => [m.id, +mean(S.members.filter(c => c.ministry === m.id).map(c => c.support)).toFixed(2)]));
      sen.caucusMean = +mean(S.members.map(c => c.support)).toFixed(2);
      emit('sentence', sen); emit('coach', coach());
      // A question beats an interrupt: the senator whose Drex `ask` answer is a question with the highest confidence (> 0.5).
      const asks = S.ministers.map(m => ({ m, a: a[`${m.id}_ask`] })).filter(x => x.a && x.a.choice !== 'none' && x.a.confidence > 0.5).sort((x, y) => y.a.confidence - x.a.confidence);
      // Floor goes to whoever Drex rates more urgent: the best question or the most urgent interrupt.
      const urgent = S.ministers.filter(m => m.interruptP > 0.6 && sen.i - m.lastInterrupt >= 2).sort((x, y) => y.interruptP - x.interruptP)[0];
      if (asks.length && (!urgent || asks[0].a.confidence >= urgent.interruptP)) {
        const { m, a: ans } = asks[0]; const qt = m.questions[+ans.choice.slice(1)]; m.asked.push(qt); m.lastInterrupt = sen.i;
        const ev = { kind: 'question', minister: m.id, short: m.short, voice: m.voice, line: qt, text: qt, p: ans.confidence, interruptP: m.interruptP, stance: m.stance, cite: null, condition: null, at: sen.i };
        S.openQuestion = ev; S.questions.push(ev); S.interrupts.push(ev); emit('interrupt', ev); emit('question', ev);
      } else {
        // Interrupt: the most urgent minister (Drex p > 0.6), at most once every 2 sentences each.
        const cand = urgent;
        if (cand) { cand.lastInterrupt = sen.i; speak(cand, sen).catch(e => emit('error', `${cand.short}'s spoken line failed: ${e.message}`)); }
      }
      return sen;
      } catch (e) { S.sentences.pop(); throw e; }   // failed address leaves no trace in the record
    } finally { S.busy = false; }
  }

  // LLM = the minister's mouth. What it argues (stance, citation, condition) was decided by Drex above.
  async function speak(m, sen) {
    const c = m.lastCite, p = m.interruptP, cond = m.condition, stance = m.stance; const cite = c ? (c.kind === 'rule' ? `Rule ${c.id} (constitution p${c.cite?.page}): ${c.text}` : `${c.fact} (${c.doc} p${c.cite?.page})`) : null;
    const line = await llm([{ role: 'system', content: `You voice the Ministry of ${m.short} in the leader's personal cabinet (mandate: ${m.mandate}). Speak ONE sentence, max 25 words, directly to the leader, in first person plural ("we"). No preamble.` },
      { role: 'user', content: `The leader just said: "${sen.text}"\nYour position (decided): ${label(m.stance)} the decision "${S.decision}".\n${cite ? `Cite this: ${cite}\n` : ''}${m.condition ? `Demand this condition: ${m.condition}\n` : ''}` }]);
    const ev = { kind: 'speech', minister: m.id, short: m.short, voice: m.voice, line, cite: c, condition: cond, stance, interruptP: p, at: sen.i };
    S.interrupts.push(ev); emit('interrupt', ev); return ev;
  }

  // Swarm drift: 50 sampled members re-score given their minister and their seat neighbours.
  let driftTimer = null;
  async function driftTick(k = 50) {
    if (S.busy || !S.sentences.length) return null;
    S.busy = true;
    try {
      const pick = [...S.members].sort(() => Math.random() - 0.5).slice(0, k);
      const q = Object.fromEntries(pick.map(c => { const m = minOf(c.ministry); return [c.id, { type: 'score', criteria: LEVELS,
        instructions: `${persona(c).replace('%M', m.short)} Your minister currently stands: ${label(m.stance)}. The members seated around you average: ${label(mean(c.neighbours.map(o => o.support)))}. You were: ${label(c.support)}. How much do you support the decision now?` }]; }));
      const a = await drex(q, stateText('The leader is silent; the caucus is talking among itself.'));
      const moves = pick.map(c => { const d = a[c.id].score - c.support; c.support = a[c.id].score; (c.history ||= []).push({ at: S.sentences.length - 1, src: 'drift', support: c.support, t: Date.now(), q: q[c.id].instructions, ans: a[c.id] }); return { id: c.id, d }; });
      emit('drift', { moved: moves, mean: mean(S.members.map(c => c.support)) });
      return moves;
    } finally { S.busy = false; }
  }
  const startDrift = (ms = 3000) => { stopDrift(); driftTimer = setInterval(() => driftTick().catch(e => emit('error', 'Drift failed: ' + e.message)), ms); };
  const stopDrift = () => { clearInterval(driftTimer); driftTimer = null; };

  // Vote: Drex gives each minister's vote + veto scope + which special thresholds apply. Code applies authority.
  async function vote({ override = false } = {}) {
    while (S.busy) await new Promise(r => setTimeout(r, 50));
    S.busy = true;
    try {
      const q = {};
      for (const m of S.ministers) {
        q[`${m.id}_vote`] = { type: 'choice', criteria: { yes: 'Yes', no: 'No', yes_with_condition: `Yes, but only with a condition${m.condition ? ` ("${m.condition}")` : ''}` }, instructions: `${ministerBrief(m)}${caucusLine(m)}\nYour current position: ${label(m.stance)}. Cast your vote on the decision.` };
        if (m.veto) q[`${m.id}_scope`] = { type: 'noul', instructions: `Does this decision, as the leader described it, fall under this veto scope: "${m.vetoScope}"?` };
      }
      (config.passage.special || []).forEach((s, i) => { q[`sp${i}`] = { type: 'noul', instructions: `Does this decision fall under: "${s.condition}"?` }; });
      const a = await drex(q, stateText('The leader has called the vote.'));
      const total = S.ministers.reduce((x, m) => x + m.weight, 0);
      S.ministers.forEach(m => { m.vote = a[`${m.id}_vote`].choice; m.voteP = a[`${m.id}_vote`].confidence; m.inScopeP = m.veto ? a[`${m.id}_scope`].noul ?? a[`${m.id}_scope`].confidence : null; });
      const yes = S.ministers.filter(m => m.vote !== 'no').reduce((x, m) => x + m.weight, 0);
      const share = yes / total;
      // Threshold: strictest of default and every special rule Drex judged applicable.
      let threshold = config.passage.default_threshold || 'simple', thresholdReason = 'default (Art. passage)';
      (config.passage.special || []).forEach((s, i) => { const p = a[`sp${i}`].noul ?? a[`sp${i}`].confidence; s.appliesP = p; if (p > 0.5 && RANK[s.threshold] > RANK[threshold]) { threshold = s.threshold; thresholdReason = s.condition; } });
      const frac = FRAC[threshold] ?? 0.5;
      const majority = threshold === 'simple' ? share > frac : share >= frac - 1e-9;
      // Vetoes: veto holder votes no and Drex says the decision is in its scope.
      const vetoes = S.ministers.filter(m => m.veto && m.vote === 'no' && m.inScopeP > 0.5).map(m => ({ id: m.id, short: m.short, scope: m.vetoScope, inScopeP: m.inScopeP, condition: m.condition }));
      // Leader override, per the constitution's structured fields.
      const L = config.leader || {};
      const overrideCheck = vetoes.map(v => {
        const needT = L.override_threshold && L.override_threshold !== 'none' ? L.override_threshold : null;
        const tOk = !needT || (needT === 'simple' ? share > 0.5 : share >= FRAC[needT] - 1e-9);
        const cOk = !L.override_needs_condition || (!!v.condition && S.accepted.some(c => c.id === v.id && c.text === v.condition));
        return { ...v, allowed: !!L.can_override_veto && tOk && cOk, thresholdOk: tOk, conditionOk: cOk, needT };
      });
      const overridden = override ? overrideCheck.filter(v => v.allowed) : [];
      const blocking = overrideCheck.filter(v => !overridden.includes(v));
      const passed = majority && blocking.length === 0;
      const conditions = [];
      [...S.accepted.map(c => ({ ...c, status: 'accepted' })), ...S.ministers.filter(m => m.vote === 'yes_with_condition' && m.condition).map(m => ({ text: m.condition, from: m.short, id: m.id, status: 'attached to yes vote' }))]
        .forEach(c => { const x = conditions.find(y => y.text === c.text); if (x) { if (!x.from.includes(c.from)) x.from += ', ' + c.from; } else conditions.push({ ...c }); });
      const dissent = S.ministers.filter(m => m.vote === 'no').map(m => ({ id: m.id, short: m.short, weight: m.weight, cite: m.lastCite, stance: m.stance }));
      const gut = Object.fromEntries(Object.keys(FACES).map(k => [k, S.sentences.filter(s => s.face?.label === k).map(s => s.i)]));
      S.verdict = { passed, yes, total, share, threshold, thresholdReason, majority, vetoes: overrideCheck, overridden: overridden.map(v => v.id), blocking: blocking.map(v => v.id), conditions, dissent, gut,
        // Display-only flag (no effect on the outcome): a senator voting yes while >= 70% of its caucus leans against, or no while >= 70% leans for.
        votes: S.ministers.map(m => { const c = caucusOf(m); const yesVote = m.vote !== 'no';
          return { id: m.id, short: m.short, weight: m.weight, vote: m.vote, p: m.voteP, inScopeP: m.inScopeP, caucus: { against: c.against, for: c.for, n: c.n, mean: +c.mean.toFixed(2) },
            defiesCaucus: yesVote ? c.against / c.n >= 0.7 : c.for / c.n >= 0.7 }; }),
        curve: S.sentences.map(s => ({ i: s.i, text: s.text, caucusMean: s.caucusMean, byMinistry: s.caucusMeanByMinistry, face: s.face?.label })),
        specials: (config.passage.special || []).map(s => ({ condition: s.condition, threshold: s.threshold, appliesP: s.appliesP })),
        acta: { state: stateText('The leader has called the vote.'), q, a } };
      emit('verdict', S.verdict); return S.verdict;
    } finally { S.busy = false; }
  }

  // Comparison: ONE LLM call gets the same constitution, evidence and transcript and is asked to decide.
  // Code then checks it against the constitution (made-up rule ids, veto/threshold vs the Senate's verdict).
  async function oneLlm() {
    const t = performance.now();
    const constText = [...config.ministries.map(m => `${m.name}: ${m.mandate} Vote weight ${m.vote_weight}.${m.has_veto ? ` Veto over: ${m.veto_scope}.` : ''}`),
      ...config.rules.map(r => `Rule ${r.id} (${r.applies_to}): ${r.text}`),
      `Passage: ${config.passage.default_threshold} majority by default; ${(config.passage.special || []).map(s => `${s.threshold} if: ${s.condition}`).join('; ')}`,
      `Leader override: ${config.leader.override_requires || 'none'}`].join('\n');
    const txt = await llm([{ role: 'system', content: 'You are an advisor applying the person\'s personal constitution to their decision. Reply with JSON only.' },
      { role: 'user', content: `Constitution:\n${constText}\n\nEvidence:\n${factsText()}\n\nDecision: "${S.decision}"\nWhat the person said:\n${S.sentences.map(s => `- ${s.text}`).join('\n')}\nAccepted conditions: ${S.accepted.map(c => c.text).join('; ') || 'none'}\n\nDecide. Reply as JSON {"decision": "yes"|"no", "reasoning": "<=60 words", "rules_cited": ["rule ids"], "vetoes_triggered": ["ministry names"], "threshold_applied": "simple|three_fifths|two_thirds|unanimous"}` }]);
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const ids = new Set(config.rules.map(r => String(r.id)));
    const cited = (j.rules_cited || []).map(String).map(x => x.replace(/^rule\s*/i, ''));
    const v = S.verdict;
    const checks = { madeUpRules: cited.filter(x => !ids.has(x)), citedRules: cited.filter(x => ids.has(x)),
      sameOutcome: v ? (j.decision === 'yes') === v.passed : null, senatePassed: v?.passed ?? null,
      vetoesSenate: v ? v.blocking.map(id => S.ministers.find(m => m.id === id).short) : null, vetoesLlm: j.vetoes_triggered || [],
      thresholdSenate: v?.threshold ?? null, thresholdLlm: j.threshold_applied };
    const out = { llm: j, ms: Math.round(performance.now() - t), checks, howItDecided: 'one LLM call: prose in, prose out, no probabilities, no enforcement' };
    S.oneLlm = out; emit('oneLlm', out); return out;
  }

  // Which threshold applies, decided by Drex at the start (so the tally shows the real target from sentence 0). Re-judged at the vote.
  async function judgeThreshold() {
    const sp = config.passage.special || []; let threshold = config.passage.default_threshold || 'simple', reason = 'default', p = null;
    if (sp.length) { const a = await drex(Object.fromEntries(sp.map((s, i) => [`sp${i}`, { type: 'noul', instructions: `Does this decision fall under: "${s.condition}"?` }])), `Decision: "${S.decision}"`);
      sp.forEach((s, i) => { const q = a[`sp${i}`].noul ?? a[`sp${i}`].confidence; if (q > 0.5 && RANK[s.threshold] > RANK[threshold]) { threshold = s.threshold; reason = s.condition; p = q; } }); }
    S.thresholdNow = { threshold, reason, p, frac: FRAC[threshold] ?? 0.5 }; emit('threshold', S.thresholdNow); return S.thresholdNow;
  }

  // Path to passage: computed from current Drex stances (a projection, not a vote) + the constitution's thresholds/vetoes.
  function coach() {
    const T = S.thresholdNow || { threshold: config.passage.default_threshold || 'simple', reason: 'default', frac: FRAC[config.passage.default_threshold] ?? 0.5 };
    const total = S.ministers.reduce((x, m) => x + m.weight, 0);
    const yesW = S.ministers.filter(m => m.stance > 2.1).reduce((x, m) => x + m.weight, 0);
    const projected = yesW / total;
    const vetoRisk = S.ministers.filter(m => m.veto && m.stance < 1.6).map(m => ({ id: m.id, short: m.short, scope: m.vetoScope, demand: m.condition, stance: m.stance }));
    const persuadable = S.ministers.filter(m => m.stance <= 2.1).sort((x, y) => (y.stance * y.weight) - (x.stance * x.weight)).slice(0, 3)
      .map(m => ({ id: m.id, short: m.short, weight: m.weight, stance: m.stance, demand: m.condition, cite: m.lastCite }));
    const openConditions = S.ministers.filter(m => m.condition && !S.accepted.some(c => c.text === m.condition)).map(m => ({ from: m.short, text: m.condition }));
    const steps = [];
    if (S.verdict) steps.push(S.verdict.passed ? 'The motion carried. See the conditions you committed to.' : 'The motion failed. See who blocked it and why, or argue again and re-divide.');
    else {
      if (S.openQuestion) steps.push(`Answer ${S.openQuestion.short}: "${S.openQuestion.text}"`);
      vetoRisk.forEach(v => steps.push(`${v.short} may veto (${v.scope}). ${v.demand ? `Accept its amendment out loud: "${v.demand}"` : 'Address its concern.'}`));
      if (projected + 1e-9 < T.frac) { const p = persuadable[0]; if (p) steps.push(`You have ${Math.round(projected * 100)}% of the ${Math.round(T.frac * 100)}% needed. Win over ${p.short} (${p.weight} vote${p.weight > 1 ? 's' : ''})${p.demand ? `: it wants "${p.demand}"` : ''}.`); }
      else if (!vetoRisk.length) steps.push('You likely have the votes. Divide the Senate when ready.');
    }
    return { threshold: T.threshold, reason: T.reason, need: T.frac, projected, yesWeight: yesW, total, vetoRisk, persuadable, openQuestion: S.openQuestion, openConditions, steps,
      ready: projected + 1e-9 >= T.frac && !vetoRisk.length, decided: !!S.verdict, note: 'Projection from current Drex stances (lean for > 2.1 of 4), not a vote.' };
  }

  async function start() {
    await Promise.all([draftConditions().catch(e => { console.warn('conditions', e); emit('error', 'conditions: ' + e.message); }), judgeThreshold().catch(e => emit('error', 'threshold: ' + e.message))]);
    return sentence(`I am putting this decision to the cabinet: ${S.decision}`);
  }
  return { state: S, on: (t, f) => ((listeners[t] ||= []).push(f), () => listeners[t] = listeners[t].filter(x => x !== f)), start, sentence, vote, oneLlm, coach, driftTick, startDrift, stopDrift, readFace, draftConditions, label };
}

import { readConstitution, readEvidence, readConstitutionText, readEvidenceText, readEvidenceUrl, buildConfig, createEngine, LEVELS, speakLine } from './engine.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const palette = ['#3B82F6','#22C55E','#F59E0B','#A855F7','#EF4444','#14B8A6','#E879F9','#A3E635'];
const portraits = ['finance','health','family','ambition','adventure','future-self'];
const stanceColors = ['#a63b43','#c27968','#a8a198','#92ad72','#58a169'];
const thresholds = {simple:.5,three_fifths:.6,two_thirds:2/3,unanimous:1};
const pct = x => Number.isFinite(x) ? (100*x).toFixed(1).replace(/\.0$/, '')+'%' : '—';
const human = x => String(x ?? '').replaceAll('_',' ');
const json = x => esc(typeof x === 'string' ? x : JSON.stringify(x,null,2));
const page = cite => cite?.page != null ? ' · p'+esc(cite.page) : '';
const detail = (title, content) => '<details><summary>'+esc(title)+'</summary>'+content+'</details>';
const citeLabel = c => c ? (c.kind === 'rule' ? 'Rule '+esc(c.id) : esc(c.doc || 'Evidence'))+page(c.cite) : '';
const citeText = c => c?.text || c?.fact || c?.cite?.quote;
let engine, samples = false, busy = false, stream, recognition, activeSpeech = false, heldSpace = false;
let pendingSpeech = '';
const flashes = new Map();
const previousSeats = new Map();
let liveSpeech, seatPositions = [], animation, seatFocus = 0;
let audioContext, currentAudio, audioAnimation;
let speechQueue = Promise.resolve();
let rippleStart = -Infinity;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const state = () => engine.state;
const minister = id => state().ministers.find(m => m.id === id);
const portraitSlug = m => m.short.toLowerCase().trim().replace(/\W+/g,'-');
const color = m => palette[portraits.includes(portraitSlug(m)) ? portraits.indexOf(portraitSlug(m)) : state().ministers.indexOf(m)%palette.length] || palette[0];
function portrait(m) {
  const slug = portraitSlug(m);
  const initials = esc(m.short.split(/\s+/).map(part => part[0]).join('').slice(0,3));
  const fallback = '<span class="portrait" aria-hidden="true">'+initials+'</span>';
  if (!portraits.includes(slug)) return fallback;
  return fallback.replace('class="portrait"','class="portrait" hidden')+
    '<img alt="" class="portrait" src="./assets/ministers/'+slug+'.png">';
}
document.body.addEventListener('error', event => {
  const img = event.target;
  if (img instanceof HTMLImageElement && img.classList.contains('portrait')) {
    img.hidden = true;
    img.previousElementSibling.hidden = false;
  }
}, true);

function showError(error) {
  const box = $('errors');
  if (box.hidden) {
    box.replaceChildren();
    const close = document.createElement('button');
    close.className = 'dismiss';
    close.textContent = 'Dismiss';
    close.onclick = () => { box.hidden = true; };
    box.append(close);
  }
  const message = document.createElement('p');
  message.textContent = error?.message || String(error);
  box.append(message);
  box.hidden = false;
}

function setBusy(value, message = '') {
  busy = value;
  $('live-status').textContent = message;
  $('vote').disabled = value;
  $('address').querySelector('button').disabled = value;
  $('mic').disabled = value || !recognition;
}

async function work(message, action) {
  if (busy) return;
  setBusy(true,message);
  try { await action(); } catch (error) { showError(error); }
  finally { setBusy(false); }
}

$('sample').onclick = () => {
  samples = true;
  $('constitution').value = '';
  $('evidence').value = '';
  $('source-status').textContent = 'constitution.pdf + offer-letter.pdf selected';
  $('decision').value ||= 'Should I quit my job to join Lumen Labs as founding engineer?';
};
fetch('/samples/constitution-template.txt').then(r => r.ok ? r.text() : '').then(t => { if (!$('const-text').value) $('const-text').value = t; });
for (const id of ['constitution','evidence','const-text','ev-urls','ev-text']) $(id).oninput = $(id).onchange = () => {
  samples = false;
  $('source-status').textContent = '';
};

// job = { name, run: () => engine read call }
async function readJob({ name, run }) {
  const line = document.createElement('div');
  $('progress').append(line);
  const start = performance.now();
  const tick = () => { line.textContent = 'NDI reading '+name+'… '+Math.floor((performance.now()-start)/1000)+' s'; };
  tick(); const timer = setInterval(tick, 250);
  try {
    const parsed = await run();
    if (!parsed.result?.data) throw new Error('NDI returned no structured extraction for '+name);
    line.textContent = 'NDI read '+name+' · '+(parsed.ms/1000).toFixed(1)+' s';
    return { ...parsed, doc: name };
  } catch (error) { line.textContent = name+' · '+error.message; throw error; }
  finally { clearInterval(timer); }
}
async function readDoc(name, source, read) {
  const line = document.createElement('div');
  $('progress').append(line);
  const start = performance.now();
  const tick = () => { line.textContent = 'NDI reading '+name+'… '+Math.floor((performance.now()-start)/1000)+' s'; };
  tick();
  const timer = setInterval(tick, 250);
  try {
    const bytes = typeof source === 'string' ? await fetch(source).then(response => {
      if (!response.ok) throw new Error('Could not load '+name+' (HTTP '+response.status+')');
      return response.arrayBuffer();
    }) : await source.arrayBuffer();
    const parsed = await read('',bytes,name);
    if (!parsed.result?.data) throw new Error('NDI returned no structured extraction for '+name);
    line.textContent = 'NDI read '+name+' · '+(parsed.ms/1000).toFixed(1)+' s';
    return parsed;
  } catch (error) {
    line.textContent = name+' · '+error.message;
    throw error;
  } finally { clearInterval(timer); }
}

$('convene').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const decision = $('decision').value.trim();
  if (!decision) return;
  const constitution = samples ? '/samples/constitution.pdf' : $('constitution').files[0];
  const evidence = samples ? ['/samples/offer-letter.pdf'] : [...$('evidence').files];
  const constText = $('const-text').value.trim();
  if (!constitution && !constText) return showError('Write your constitution in the box, upload a constitution PDF, or use the example.');
  const name = source => typeof source === 'string' ? source.split('/').at(-1) : source.name;
  // Extra evidence the user typed: links (NDI reads the page) and pasted text (rendered to PDF, NDI reads it).
  const extraJobs = samples ? [] : [
    ...$('ev-urls').value.split(/\s+/).filter(u => /^https?:\/\//.test(u)).map(u => ({ name: u.replace(/^https?:\/\//,'').slice(0,60), run: () => readEvidenceUrl('', u) })),
    ...($('ev-text').value.trim() ? [{ name: 'pasted evidence', run: () => readEvidenceText('', $('ev-text').value.trim(), 'pasted-evidence.pdf') }] : [])];
  const constJob = constitution ? { name: name(constitution), run: () => readDoc(name(constitution),constitution,readConstitution) }
    : { name: 'my constitution (written here)', run: () => readConstitutionText('', constText) };
  const inputs = [...$('convene').querySelectorAll('button,input,textarea')];
  for (const input of inputs) input.disabled = true;
  busy = true;
  $('progress').replaceChildren();
  $('rollcall').replaceChildren();
  $('errors').hidden = true;
  try {
    const results = await Promise.allSettled([
      constitution ? readDoc(name(constitution),constitution,readConstitution) : readJob(constJob),
      ...evidence.map(async doc => ({ ...(await readDoc(name(doc),doc,readEvidence)),doc:name(doc) })),
      ...extraJobs.map(readJob)
    ]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const [c,...e] = results.map(x => x.value);
    const config = buildConfig(c.result,e);
    if (!config.ministries.length) throw new Error('NDI found no ministries in the constitution.');
    for (const [index,m] of config.ministries.entries()) {
      const badge = document.createElement('span');
      badge.className = 'entrance';
      badge.style.animationDelay = index*100+'ms';
      badge.textContent = m.short+' ('+m.vote_weight+(m.vote_weight===1?' vote':' votes')+(m.has_veto ? ', veto' : '')+')'+(m.cite?.page ? ', p. '+m.cite.page : '');
      $('rollcall').append(badge);
    }
    const opening = document.createElement('div');
    opening.textContent = 'Drafting amendments and evaluating the opening motion…';
    $('progress').append(opening);
    engine?.stopDrift();
    engine = createEngine({config,decision});
    bindEngine();
    await engine.start();
    $('motion').textContent = decision;
    $('setup').hidden = true;
    $('chamber').hidden = false;
    renderChamber();
    engine.startDrift(3000);
  } catch (error) { showError(error); }
  finally {
    for (const input of inputs) input.disabled = false;
    setBusy(false);
  }
};

function bindEngine() {
  engine.on('drex', row => { $('ticker').textContent = 'Drex: '+row.n+' decisions in '+(row.ms/1000).toFixed(2)+' s'; });
  engine.on('error',showError);
  engine.on('sentence',() => {
    rippleStart = performance.now();
    renderChamber();
  });
  engine.on('drift',drawSeats);
  engine.on('face',renderFace);
  engine.on('accepted', amendment => { $('subtitle').textContent = 'Amendment accepted · '+amendment.text; });
  engine.on('interrupt', playSpeech);
  engine.on('verdict',renderVerdict);
  engine.on('oneLlm',renderOracle);
}

function meter(value, threshold) {
  return '<div class="meter"><i style="width:'+pct(value)+'"></i><b style="left:'+pct(threshold)+'"></b></div>';
}
function renderChamber() {
  if ($('chamber').hidden) return;
  const s = state();
  const weight = s.ministers.reduce((total,m) => total + m.weight,0);
  const support = s.ministers.reduce((total,m) => total + m.weight*m.stance,0)/(4*weight);
  const threshold = s.config.passage.default_threshold;
  $('tally').innerHTML = '<span>Weighted stance <strong>'+pct(support)+'</strong></span>'+meter(support,thresholds[threshold])+
    '<small>Default threshold: '+esc(human(threshold))+page(s.config.passageCite)+'</small>';
  $('chamber').classList.toggle('has-speaker', Boolean(liveSpeech));
  const markup = s.ministers.map(card);
  const split = Math.ceil(markup.length/2);
  $('left').innerHTML = markup.slice(0,split).join('');
  $('right').innerHTML = markup.slice(split).join('');
  $('rim').innerHTML = s.ministers.map(m => '<span><i aria-hidden="true" style="background:'+color(m)+'"></i>'+esc(m.short)+'</span>').join('');
  $('curve').innerHTML = curve();
  drawSeats();
}

function card(m) {
  const stance = Math.max(0,Math.min(4,Math.round(m.stance)));
  const speaking = liveSpeech?.minister === m.id || liveSpeech?.short === m.short;
  const name = (m.veto ? 'Tribune' : 'Senator')+' of '+m.short;
  return '<article data-seat-owner="'+esc(m.id)+'" class="senator'+(speaking?' speaking':'')+'">'+
    '<button class="card-top" data-minister="'+esc(m.id)+'">'+portrait(m)+'<span><h3>'+esc(name)+
    (speaking ? ' <span class="wave" aria-label="Speaking"><i></i><i></i><i></i></span>' : '')+'</h3>'+
    '<span class="stance" aria-label="'+esc(LEVELS[stance])+'" title="'+esc(LEVELS[stance])+'">'+
    stanceColors.map((c,i) => '<i class="'+(i===stance?'active':'')+'" style="background:'+c+'"></i>').join('')+'</span></span></button>'+
    (m.condition ? '<p class="demand">'+esc(m.condition)+'</p>' : '')+
    (m.lastCite ? '<button class="chip" data-cite="'+esc(m.id)+'">'+citeLabel(m.lastCite)+'</button>' : '')+
    (speaking ? '<div class="speech">'+esc(liveSpeech.line)+'</div>' : '')+'</article>';
}

function unlockAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  audioContext ||= new Audio();
  if (audioContext.state === 'suspended') void audioContext.resume().catch(()=>{});
}
document.addEventListener('pointerdown',unlockAudio);
document.addEventListener('keydown',unlockAudio);

function animateSpeech(audio, event) {
  currentAudio = audio;
  if (!$('division').hidden) audio.muted = true;
  let analyser, source, samples;
  if (audioContext?.state === 'running') {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source = audioContext.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    samples = new Float32Array(analyser.fftSize);
  }
  audio.addEventListener('playing',()=>{
    if (!$('division').hidden) return;
    liveSpeech = event;
    renderChamber();
    if (!analyser || reducedMotion.matches) return;
    let envelope = 0;
    const tick = () => {
      if (audio.ended || audio.paused || liveSpeech !== event) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
      envelope += (Math.min(1,rms*5)-envelope)*.34;
      $('chamber').style.setProperty('--speech-lift',(-7*envelope).toFixed(2)+'px');
      $('chamber').style.setProperty('--speech-level',(.22+envelope*.78).toFixed(2));
      audioAnimation = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(audioAnimation);
    audioAnimation = requestAnimationFrame(tick);
  });
  const disconnect = () => { source?.disconnect(); analyser?.disconnect(); };
  audio.addEventListener('ended',disconnect,{once:true});
  audio.addEventListener('error',disconnect,{once:true});
  return disconnect;
}

function playSpeech(event) {
  if (!event.line) return;
  speechQueue = speechQueue.then(async ()=>{
    if (!$('division').hidden) return;
    let dispose;
    try {
      await speakLine('',event.line,event.voice,audio => {
        dispose = animateSpeech(audio,event);
      });
    } catch (error) { showError(error); }
    finally {
      dispose?.();
      currentAudio = null;
      liveSpeech = null;
      cancelAnimationFrame(audioAnimation);
      $('chamber').style.removeProperty('--speech-lift');
      $('chamber').style.removeProperty('--speech-level');
      renderChamber();
    }
  });
}

// Continuous seat colour: interpolate between the 5 stance colours so small Drex differences stay visible.
const hex = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16));
function blend(v) {
  const x = Math.max(0,Math.min(4,v)), i = Math.min(3,Math.floor(x)), f = x-i, a = hex(stanceColors[i]), b = hex(stanceColors[i+1]);
  return 'rgb('+a.map((c,k)=>Math.round(c+(b[k]-c)*f)).join(',')+')';
}
const canvas = $('seats');
canvas.tabIndex = 0;
function drawSeats() {
  if ($('chamber').hidden) return;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
    canvas.width = Math.round(width*dpr);
    canvas.height = Math.round(height*dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,width,height);
  const span = Math.min(width*.45,height*.94);
  const base = height-8;
  const seats = state().members;
  ctx.strokeStyle = '#c8a06475';
  for (let i=1;i<seats.length;i++) {
    if (seats[i-1].ministry === seats[i].ministry) continue;
    const angle = (seats[i-1].seat.th+seats[i].seat.th)/2;
    if (!Number.isFinite(angle)) continue;
    ctx.beginPath();
    ctx.moveTo(width/2+Math.cos(angle)*span*.32,base-Math.sin(angle)*span*.32);
    ctx.lineTo(width/2+Math.cos(angle)*span*1.01,base-Math.sin(angle)*span*1.01);
    ctx.stroke();
  }
  const now = performance.now();
  const radius = Math.max(2.3,Math.min(6,span/37));
  seatPositions = seats.map((member,i) => {
    const x = width/2+member.seat.x*span;
    const y = base-member.seat.y*span;
    const previous = previousSeats.get(member.id);
    if (!reducedMotion.matches && previous != null && Math.abs(previous-member.support)>.01) {
      const delay = now-rippleStart < 70 ? 330*Math.hypot(member.seat.x,member.seat.y) : 0;
      flashes.set(member.id,{start:now+delay,previous});
    }
    previousSeats.set(member.id,member.support);
    const flash = flashes.get(member.id);
    const elapsed = flash ? now-flash.start : Infinity;
    const blendAmount = Math.max(0,Math.min(1,elapsed/220));
    const pulse = flash && elapsed>=0 ? Math.max(0,1-elapsed/400) : 0;
    if (elapsed>=400) flashes.delete(member.id);
    const r = radius+2*pulse;
    ctx.fillStyle = blend(flash ? flash.previous+(member.support-flash.previous)*blendAmount : member.support);
    ctx.strokeStyle = (document.activeElement === canvas && i === seatFocus) || pulse>.4 ? '#fff2bd' : color(minister(member.ministry));
    ctx.beginPath();
    ctx.roundRect(x-r,y-r*.65,r*2,r*1.3,2);
    ctx.fill();
    ctx.stroke();
    return {x,y,member};
  });
  cancelAnimationFrame(animation);
  if (flashes.size) animation = requestAnimationFrame(drawSeats);
}
new ResizeObserver(drawSeats).observe(canvas);
canvas.onclick = event => {
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX-bounds.left, y = event.clientY-bounds.top;
  let distance = 15, hit;
  for (const seat of seatPositions) {
    const d = Math.hypot(x-seat.x,y-seat.y);
    if (d < distance) { distance=d; hit=seat; }
  }
  if (hit) auditSeat(hit.member);
};
canvas.onkeydown = event => {
  const move = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-1,ArrowDown:1}[event.key];
  if (move && seatPositions.length) {
    event.preventDefault();
    seatFocus = (seatFocus+move+seatPositions.length)%seatPositions.length;
    drawSeats();
  }
  if (['Enter',' '].includes(event.key) && seatPositions[seatFocus]) {
    event.preventDefault();
    auditSeat(seatPositions[seatFocus].member);
  }
};
canvas.onfocus = canvas.onblur = drawSeats;

function curve() {
  const rows = state().sentences.filter(row=>row.acta);
  if (!rows.length) return '';
  const w = 650, h = 68;
  const x = i => 17+i*(w-34)/Math.max(1,rows.length-1);
  const y = v => h-8-v*(h-16)/4;
  const series = [{c:'#f7d995',read:r=>r.caucusMean},...state().ministers.map(m=>({c:color(m),read:r=>r.caucusMeanByMinistry[m.id]}))];
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="Overall and ministry caucus support by sentence">'+
    [0,2,4].map(v=>'<path d="M16 '+y(v)+'H634" stroke="#896f5055"/>').join('')+
    series.slice().reverse().map(({c,read}) => {
      const points = rows.flatMap((r,i) => Number.isFinite(read(r)) ? [[x(i),y(read(r))]] : []);
      return '<polyline fill="none" stroke="'+c+'" stroke-width="1.7" points="'+points.map(p=>p.join(',')).join(' ')+'"/>'+
        points.map(([a,b])=>'<circle cx="'+a+'" cy="'+b+'" r="2.4" fill="'+c+'"/>').join('');
    }).join('')+
    rows.map((r,i)=>r.face ? '<circle cx="'+x(i)+'" cy="'+y(r.caucusMean)+'" r="5.2" fill="none" stroke="#fff0be"><title>'+esc(r.face.label)+' · '+esc(pct(r.face.conf))+'</title></circle>' : '').join('')+'</svg>';
}

function audit(title, content) {
  $('audit-title').textContent = 'Acta Senatus · '+title;
  $('audit-body').innerHTML = content;
  if (!$('acta').open) $('acta').showModal();
  $('acta').scrollTop = 0;
}
const dump = value => '<pre>'+json(value)+'</pre>';
function questions(q,a) {
  return Object.entries(q || {}).map(([id,question]) => detail(id,dump({question,answer:a?.[id]}))).join('');
}

function auditMinister(m) {
  const s = state();
  audit(m.short,'<p>'+esc(m.mandate)+'</p><p>Vote weight: '+esc(m.weight)+'; stance: '+m.stance.toFixed(2)+'/4'+(m.ally ? '; ally: '+esc(minister(m.ally)?.short) : '')+'</p><p class="meta">Constitution'+page(m.cite)+'</p>'+
    (m.cite?.quote ? '<blockquote>'+esc(m.cite.quote)+'</blockquote>' : '')+
    (m.veto ? '<p>Veto scope · '+esc(m.vetoScope)+'</p>' : '')+
    s.sentences.filter(row=>row.acta).reverse().map(row=>{
      const a = row.acta;
      const own = Object.fromEntries(Object.entries(a.q).filter(([id])=>id.startsWith(m.id+'_')));
      return detail((row.i ? 'Address '+row.i : 'Opening motion')+' · '+row.text,
        questions(own,a.a)+detail('Exact Drex context',dump(a.state)));
    }).join(''));
}
function auditSeat(member) {
  const m = minister(member.ministry);
  const history = [...(member.history || [])].reverse();
  const latest = history[0];
  const acta = state().sentences.find(row=>row.i===latest?.at)?.acta;
  audit(m.short+' / '+member.id,'<p>'+esc(member.traits)+'</p><p>Current support · '+member.support.toFixed(2)+'/4</p>'+
    (latest ? detail('Latest '+latest.src+' question and answer',dump({question:latest.q || acta?.cq[member.id],answer:latest.ans || acta?.ca[member.id]})) : '')+
    (acta && latest.src === 'sentence' ? detail('Exact caucus context',dump(acta.caucusState ?? acta.cstate ?? acta.state)) : '')+
    '<h3>Support history</h3><table><thead><tr><th>Address</th><th>Source</th><th>Support</th></tr></thead><tbody>'+
    history.map(row=>'<tr><td>'+row.at+'</td><td>'+esc(row.src)+'</td><td>'+row.support.toFixed(2)+'/4</td></tr>').join('')+'</tbody></table>');
}
$('chamber').addEventListener('click',event=>{
  const btn = event.target.closest('[data-minister],[data-cite]');
  if (!btn) return;
  const m = minister(btn.dataset.minister || btn.dataset.cite);
  if (btn.dataset.cite) audit(m.short+' · citation','<p>'+citeLabel(m.lastCite)+'</p><blockquote>'+esc(citeText(m.lastCite))+'</blockquote>');
  else auditMinister(m);
});
$('transcript').onclick = () => audit('Transcript',state().sentences.filter(row=>row.acta).map(row=>detail(
  (row.i?'Address '+row.i:'Opening motion')+' · '+row.text,
  (row.face ? '<p>Expression reading · '+esc(row.face.label)+'</p>' : '')+
  detail('Exact Drex context',dump(row.acta.state))+questions(row.acta.q,row.acta.a)
)).join('')+state().interrupts.map(item=>'<blockquote>'+esc(item.short)+' · '+esc(item.line)+'</blockquote>').join(''));

function renderFace(face) {
  const probabilities = Object.entries(face.probs || {});
  $('face').innerHTML = '<span>Expression · '+esc(face.label)+'</span>'+
    (probabilities.length ? '<div class="face-bars">'+probabilities.map(([label,p])=>'<span title="'+esc(label+' '+pct(p))+'"><i style="width:'+pct(p)+'"></i></span>').join('')+'</div>' : Number.isFinite(face.conf) ? ' · '+pct(face.conf) : '');
}
function stopCamera() {
  stream?.getTracks().forEach(track=>track.stop());
  stream = null;
  $('camera').srcObject = null;
  $('camera').hidden = true;
  $('bust').hidden = false;
  $('cam').textContent = 'Camera off';
  $('cam').setAttribute('aria-pressed','false');
  $('face').replaceChildren();
}
$('cam').onclick = async () => {
  if (stream) return stopCamera();
  $('cam').disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires a secure browser context.');
    stream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
    $('camera').srcObject = stream;
    $('camera').hidden = false;
    $('bust').hidden = true;
    $('cam').textContent = 'Camera on';
    $('cam').setAttribute('aria-pressed','true');
    stream.getVideoTracks()[0]?.addEventListener('ended',stopCamera,{once:true});
  } catch (error) { showError(error); }
  finally { $('cam').disabled = false; }
};
function frame() {
  const video = $('camera');
  if (!stream || !video.videoWidth) return undefined;
  const image = document.createElement('canvas');
  image.width = 640;
  image.height = 480;
  image.getContext('2d').drawImage(video,0,0,640,480);
  return image.toDataURL('image/jpeg',.78);
}
async function address(text) {
  if (!text.trim() || busy || $('chamber').hidden) return;
  $('subtitle').textContent = text;
  await work('Drex evaluating address…',()=>engine.sentence(text,{frame:frame()}));
}
$('address').onsubmit = event => {
  event.preventDefault();
  const input = $('words');
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  void address(text);
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onresult = ({results}) => {
    pendingSpeech = [...results].filter(result=>result.isFinal).map(result=>result[0].transcript.trim()).join(' ');
    $('subtitle').textContent = [...results].map(result=>result[0].transcript.trim()).join(' ');
  };
  recognition.onend = () => {
    activeSpeech = false;
    $('chamber').classList.remove('consul-speaking');
    $('mic').setAttribute('aria-pressed','false');
    if (pendingSpeech) void address(pendingSpeech);
    pendingSpeech = '';
  };
  recognition.onerror = event => {
    if (!['aborted','no-speech'].includes(event.error)) showError('Microphone: '+event.error+'. You can type your address.');
  };
} else {
  $('mic').textContent = 'Voice unavailable · use text';
  $('mic').disabled = true;
}
function startMic() {
  if (!recognition || activeSpeech || busy || $('chamber').hidden) return;
  try {
    pendingSpeech = '';
    recognition.start();
    activeSpeech = true;
    $('chamber').classList.add('consul-speaking');
    $('mic').setAttribute('aria-pressed','true');
    $('subtitle').textContent = 'Listening…';
  } catch (error) { showError(error); }
}
function stopMic() {
  if (activeSpeech) recognition.stop();
}
$('mic').onclick = () => activeSpeech ? stopMic() : startMic();
document.addEventListener('keydown',event=>{
  if (event.defaultPrevented || event.code !== 'Space' || event.repeat || $('chamber').hidden || $('acta').open ||
      event.target.closest?.('button,input,textarea,select,summary,[contenteditable]')) return;
  event.preventDefault();
  heldSpace = true;
  startMic();
});
document.addEventListener('keyup',event=>{
  if (event.code !== 'Space' || !heldSpace) return;
  event.preventDefault();
  heldSpace = false;
  stopMic();
});
window.addEventListener('blur',()=>{
  if (heldSpace) { heldSpace = false; stopMic(); }
});
window.addEventListener('pagehide',()=>{
  engine?.stopDrift();
  stopCamera();
});

$('vote').onclick = () => work('Drex tallying the division…',async()=>{
  engine.stopDrift();
  try { await engine.vote(); }
  catch (error) { engine.startDrift(3000); throw error; }
});

function renderVerdict(v) {
  engine.stopDrift();
  stopMic();
  stopCamera();
  if (currentAudio) currentAudio.muted = true;
  $('chamber').hidden = true;
  const s = state();
  const special = v.specials?.find(row=>row.condition===v.thresholdReason && row.threshold===v.threshold);
  const comparison = '<button id="oracle-button">Ask one LLM</button><div id="oracle-result" aria-live="polite"></div>';
  $('division').innerHTML =
    '<section class="verdict-card"><p class="division-label">The division</p><h2 class="verdict-title">'+(v.passed?'Senatus Consultum':'Motio Reiecta')+'</h2>'+
    '<p>'+esc(s.decision)+'</p><div class="totals"><span><strong>'+esc(v.yes)+'</strong> AYES</span><span><strong>'+esc(v.total-v.yes)+'</strong> NOES</span></div>'+
    meter(v.share,thresholds[v.threshold])+'<p>'+pct(v.share)+' weighted ayes · '+esc(human(v.threshold))+' required</p>'+
    '<p class="meta">'+esc(v.thresholdReason)+ (special ? ' · Drex '+pct(special.appliesP)+page(special.cite) : page(s.config.passageCite))+'</p>'+
    (v.specials || []).map(row=>'<p class="meta">Special threshold · '+esc(row.condition)+' · '+esc(human(row.threshold))+' · '+pct(row.appliesP)+page(row.cite)+'</p>').join('')+
    v.vetoes.map(item=>{
      const m = minister(item.id);
      const overridden = v.overridden.includes(item.id);
      return '<div class="veto"><strong>'+(overridden?'OVERRIDDEN':'VETO')+' — '+esc(m.short.toUpperCase())+'</strong><p>'+esc(item.scope)+page(m.cite)+
        ' · Drex in scope '+pct(item.inScopeP)+(item.inScopeP>=.4 && item.inScopeP<=.6?' · borderline':'')+'</p>'+
        '<p>Override '+(item.allowed?'permitted':'unavailable')+page(s.config.leaderCite)+' · '+esc(human(item.needT || 'no override threshold'))+' '+(item.thresholdOk?'met':'unmet')+
        ' · '+(s.config.leader.override_needs_condition ? (item.conditionOk?'condition accepted':'condition outstanding') : 'no acceptance required')+'</p></div>';
    }).join('')+
    (v.vetoes.some(row=>row.allowed && !v.overridden.includes(row.id)) && !v.overridden.length ? '<button class="gold" id="override">Override veto</button> ' : '')+
    '<button id="vote-acta">View division in Acta Senatus</button></section>'+
    '<div class="division-grid"><section class="verdict-card"><h3>Votes</h3><table><thead><tr><th>Senator</th><th>Weight</th><th>Vote</th><th>Caucus</th><th>Confidence</th></tr></thead><tbody>'+
    v.votes.map(row => {
      const c = row.caucus;
      const caucus = c ? esc(c.for)+'/'+esc(c.n)+' for, '+esc(c.against)+'/'+esc(c.n)+' against' : '—';
      const defied = row.defiesCaucus ? '<span class="caucus-defied">Defied its caucus</span>' : '';
      return '<tr><td>'+esc(row.short)+'</td><td>'+esc(row.weight)+'</td><td>'+esc(human(row.vote))+'</td><td>'+caucus+defied+'</td><td>'+pct(row.p)+'</td></tr>';
    }).join('')+'</tbody></table>'+
    '<h3>Dissent</h3>'+(v.dissent.map(row=>'<div class="dissent">'+portrait(minister(row.id))+'<div>'+esc(row.short)+' · '+esc(row.weight)+' weight'+
      (row.cite ? '<p class="meta">'+citeLabel(row.cite)+'</p><p>'+esc(citeText(row.cite))+'</p>' : '')+'</div></div>').join('')||'<p class="quiet">No dissenting votes</p>')+'</section>'+
    '<section class="verdict-card"><h3>Amendments</h3>'+(v.conditions.map(row=>'<div class="ticket">'+esc(row.text)+'<p class="meta">'+esc(row.from)+' · '+esc(row.status)+'</p></div>').join('')||'<p class="quiet">No amendments recorded</p>')+
    '<h3>Caucus support</h3>'+curve()+'<h3>Consul’s expression readings</h3>'+
    (Object.entries(v.gut).flatMap(([label,indices])=>indices.map(i=>'<p>'+esc(label)+' · “'+esc(s.sentences.find(r=>r.i===i)?.text)+'”</p>')).join('')||'<p class="quiet">No webcam readings recorded</p>')+'</section></div>'+
    '<section class="verdict-card"><h3>One oracle vs the Senate</h3><p>Oracle: one prose answer, no probabilities or enforcement.</p>'+
    '<p>Senate: '+s.drexLog.reduce((n,row)=>n+row.n,0)+' Drex questions answered, with source citations and constitutional powers enforced in code.</p>'+
    comparison+'</section>';
  $('division').hidden = false;
  window.scrollTo(0,0);
  $('vote-acta').onclick = () => audit('Division',detail('Exact Drex context',dump(v.acta.state))+questions(v.acta.q,v.acta.a));
  if ($('override')) $('override').onclick = event => divisionCall(event.currentTarget,'Drex reviewing override…',()=>engine.vote({override:true}));
  $('oracle-button').onclick = event => divisionCall(event.currentTarget,'Waiting for the oracle…',()=>engine.oneLlm());
}
async function divisionCall(button, message, action) {
  const original = button.textContent;
  const controls = [...$('division').querySelectorAll('#oracle-button,#override')];
  for (const control of controls) control.disabled = true;
  button.textContent = message;
  try { await action(); }
  catch (error) { showError(error); }
  finally {
    for (const control of controls) control.disabled = false;
    button.textContent = original;
  }
}
function renderOracle({llm,checks,ms}) {
  const normalize = v => String(v).trim().toLowerCase().replace(/^(senator|ministry|tribune) (of|for) /,'');
  const missed = (checks.vetoesSenate || []).filter(name=>!(checks.vetoesLlm || []).some(item=>normalize(item)===normalize(name)));
  $('oracle-result').innerHTML = '<div class="division-grid"><div><h3>Oracle · '+esc(human(llm.decision))+
    '</h3><p>'+esc(llm.reasoning)+'</p><p class="meta">'+(ms/1000).toFixed(2)+' s · threshold '+esc(human(checks.thresholdLlm))+
    '</p></div><div><h3>Senate · '+(checks.senatePassed?'carried':'rejected')+
    '</h3><p>Threshold '+esc(human(checks.thresholdSenate))+'</p><p>Same outcome · '+(checks.sameOutcome?'yes':'no')+
    '</p><p>Unrecognized rule IDs · '+esc(checks.madeUpRules.join(', ') || 'none')+
    '</p><p>Blocking vetoes omitted by oracle · '+esc(missed.join(', ') || 'none')+'</p></div></div>';
}

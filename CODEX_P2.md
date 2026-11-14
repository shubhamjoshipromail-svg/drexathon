# Codex task: P2 UI + art for The Cabinet ("The Senate of You") — working by 1:45 PM PT

Read `PLAN.md` and `COORDINATION.md` first; log your work there. You own ONLY: `public/index.html`, `public/view.js`, `public/style.css`, `public/assets/`. Do NOT edit `public/engine.js`, `public/schemas.js`, `server.mjs` (Claude owns them; put engine requests at the bottom of this file).

**Hard rule: NO FAKING.** Everything on screen comes from the engine (live NDI / Drex / LLM). No placeholder numbers, demo data, scripted lines or cached results. While waiting, show a real loading state ("NDI reading constitution.pdf… 14 s"). If a call fails, show the error; no silent fallback. No framework, no build step, no npm installs. Plain ES modules.

Run: `node server.mjs` → http://localhost:5173 (if taken: `PORT=5175 node server.mjs`). `/samples/*.pdf` is served. Reference for Web Speech + webcam code: `archive/shout-command/game.js`, `public/gate-cam.html`.

## Engine API (`public/engine.js`)
```js
import { readConstitution, readEvidence, buildConfig, createEngine, LEVELS, FACES } from './engine.js';
const bytes = await (await fetch('/samples/constitution.pdf')).arrayBuffer();   // or File.arrayBuffer()
const [c, e] = await Promise.all([readConstitution('', bytes, 'constitution.pdf'), readEvidence('', bytes2, 'offer-letter.pdf')]); // ~20-30 s, -> { ms, result }
const config = buildConfig(c.result, [{ result: e.result, doc: 'offer letter' }]);
const eng = createEngine({ config, decision: 'Should I quit my job to join Lumen Labs as founding engineer?' });
eng.on('drex'|'sentence'|'interrupt'|'accepted'|'face'|'drift'|'conditions'|'verdict'|'oneLlm'|'error', fn);
await eng.start();                      // LLM drafts 3 conditions per minister, then opening round (~3 s)
eng.startDrift(3000);                   // swarm drift every 3 s (skips while busy); eng.stopDrift()
await eng.sentence(text, { frame });    // frame = webcam JPEG dataURL 640x480 (optional). ~2 s. Queued.
const v = await eng.vote();             // if v.vetoes.some(x => x.allowed): offer "Override veto" -> eng.vote({ override: true })
await eng.oneLlm();                     // after the vote: same inputs to ONE LLM call, plus code checks (comparison panel)
eng.state                               // live state
```

## Shapes
- `config`: `ministries[{id,name,short,mandate,vote_weight,has_veto,veto_scope,cite:{page,quote}}]`, `rules[{id,text,applies_to,cite}]`, `facts[{id,fact,topic,doc,cite:{page,quote}}]`, `passage{default_threshold, special[{condition,threshold}]}`, `leader{can_override_veto,override_requires,override_threshold,override_needs_condition}`, `leaderCite`.
- `state.ministers[]`: `{id, short, name, mandate, weight, veto, vetoScope, cite, rules[], stance (0..4 float), stanceP, conditions[3] (LLM-drafted), condition (current demand|null), ally (minister id|null), interruptP, lastCite ({kind:'rule',id,text,cite:{page}} | {kind:'fact',fact,doc,cite:{page}} | null), vote, voteP, inScopeP, history[{i,stance,cite,interruptP}] }`
- `state.members[]` (~150): `{id, ministry, traits ('cautious, thinks about the next decade'), seat:{x (-1..1), y (0..1)}, support (0..4), neighbours[], history[{at, src:'sentence'|'drift', support, q?, ans?}]}`.
- `state.sentences[]` / `'sentence'`: `{i, text, face|null, ministerDeltas{id:Δ}, caucusMeanByMinistry{id:mean}, caucusMean, acta:{state, q, a, cq, ca}}`. i=0 is the opening.
- **Acta** (audit): `acta.state` = the exact context text Drex saw; `acta.q["m1_stance"]` = the question (instructions + criteria) and `acta.a["m1_stance"]` = the raw answer (`score`/`choice`/`noul`, `confidence`, `probabilities` when present). Keys per minister: `<id>_stance`, `_interrupt`, `_cite`, `_condition`, `_ally`; plus `accept`. Caucus: `acta.cq[memberId]`, `acta.ca[memberId]`.
- `'interrupt'`: `{minister, short, line (LLM words), cite, condition, stance, interruptP, at}`.
- `'accepted'`: `{text, from, id}`. `'face'`: `{label, conf, probs}`. `'drift'`: `{moved:[{id,d}], mean}`. `'drex'`: `{n, ms, evalMs, model}`.
- `'verdict'`: `{passed, yes, total, share, threshold, thresholdReason, majority, specials[{condition,threshold,appliesP}], vetoes[{id,short,scope,inScopeP,allowed,thresholdOk,conditionOk}], overridden[], blocking[], conditions[{text,from,status}], dissent[{short,weight,cite}], gut{label:[sentence i]}, votes[{short,weight,vote,p,inScopeP}], curve[...], acta:{state,q,a}}`.
- `'oneLlm'`: `{llm:{decision,reasoning,rules_cited,vetoes_triggered,threshold_applied}, ms, checks:{madeUpRules[], citedRules[], sameOutcome, senatePassed, vetoesSenate[], vetoesLlm[], thresholdSenate, thresholdLlm}}`.
- `LEVELS` = 5 stance labels (0 strongly against .. 4 strongly for). `FACES` = face labels.

## THEME: "The Senate of You" (Roman)
A Roman senate in your head. Marble, torchlight, laurel, deep oxblood + gold + ivory. Display font: a Roman capital serif (Google Fonts: "Cinzel" for titles, "Cormorant Garamond" for prose); data in a clean sans ("Inter"). **Data overlays stay modern and crisp** (bars, threshold lines, curve) so numbers read on a projector. One page, no scroll at 1440x900. Vocabulary: ministers = **Senators**; veto holders = **Tribunes** ("veto" is Latin: "I forbid"); you = **the Consul**; vote = **"Divide the Senate"**; result = **"SENATUS CONSULTUM"** (carried) / **"MOTIO REIECTA"** (rejected); audit log = **Acta Senatus**. Keep the real ministry names visible too ("Senator of Health").

**Chamber screen layout:**
- **Top: the Motion** (decision in Cinzel on a marble frieze). Right: threshold needed + reason + page; live **tally bar** (weighted stance support, threshold line marked); Drex ticker ("Drex · 150 decisions · 1.8 s").
- **Centre: the hemicycle** (canvas, ~60% width): ~150 seats as small marble benches in tiers, coloured by `support` (0 deep red → 2 stone grey → 4 laurel green), ministry sectors split by thin gold lines, labelled at the rim in ministry colour. Seats pulse when they change. **Click a seat → Acta popover**: its persona, its last question and raw answer, its support history (sentence vs drift moves).
- **Bottom centre, at the focus of the arc: THE CONSUL (you)** on a rostrum: live webcam in an oval laurel-wreath frame, captioned "CONSUL". Under it: face reading (label + bars), mic indicator "Hold SPACE to address the Senate", live subtitles, hint "Reasons · Trades · Fears". Webcam off → gold silhouette bust.
- **Senators' cards**: 3 left, 3 right (5-8 split evenly). Each: portrait, "Senator of X" in ministry colour, weight pips, a red wax seal "TRIBUNE · VETO" if veto, stance gauge (5 levels), latest citation chip ("Rule 2.2 · p2" / "Offer letter · p1"), current demanded condition as a parchment ticket, gold thread to ally. **Interrupt**: card rises + glows, speech bubble for ~6 s, `speechSynthesis` speaks it (distinct voice/pitch each). Small label on the bubble: "words by LLM · position, citation, condition by Drex". **Click a card → Acta panel** for that senator: per sentence, each of its 5 questions with the raw answer + probabilities, and the context it saw.
- **Bottom strip**: support curve (overall + per-ministry lines in ministry colours, face marker per sentence), transcript drawer. Gold button **"DIVIDE THE SENATE"** (vote).

**Ministry colours** (unknown ministries: same palette in order): Finance #3B82F6, Health #22C55E, Family #F59E0B, Ambition #A855F7, Adventure #EF4444, Future Self #14B8A6.

**Verdict screen "The Division"**: huge weighted AYES vs NOES with the threshold line, why that threshold applied (special rule + Drex probability + page). SENATUS CONSULTUM / MOTIO REIECTA. If a veto blocks: red wax-seal stamp "VETO — TRIBUNE OF HEALTH" with scope + page + Drex in-scope probability (show "borderline" if 0.4-0.6), and the override panel (allowed? 2/3 met? condition accepted?) with an "Override veto" button only when allowed. Conditions as signed amendments. Dissent with portraits + citations. Vote table. Curve. Gut readout ("You looked anxious while saying: …"). **Comparison panel "One oracle vs the Senate"**: button runs `eng.oneLlm()`; show the LLM's decision + reasoning next to the Senate's verdict and the code checks (made-up rule ids, vetoes it missed, threshold it used, same outcome?). Plus the line: "Oracle: one prose answer, no probabilities, no enforcement. Senate: N independent Drex decisions, cited, powers enforced in code." (N = total questions from the `drex` log).

**Setup screen**: same chamber, dimmed. "Convene the Senate": decision input, Use samples / upload PDFs (1 constitution, 1+ evidence), NDI progress per document with elapsed seconds. When NDI returns, senators enter one by one with their cited powers (page numbers), then the chamber.

## Art (you make it: your own image generation, or Adobe Firefly on the web via computer use if you prefer; Firefly earns the Adobe prize, so use it if it is not slower)
One consistent style: painted Roman-senate portraits, head and shoulders, white toga with a sash in the ministry colour, marble + torchlight backdrop, no text. Square ~768-1024px PNG into `public/assets/ministers/`:
- `finance.png` stern older senator with a ledger tablet and coin purse. `health.png` athletic, calm, laurel and a cup of water. `family.png` warm, holding a small family portrait medallion. `ambition.png` sharp-eyed, holding a scroll and gazing upward. `adventure.png` windswept, a traveller's cloak over the toga, holding a compass/astrolabe. `future-self.png` silver-haired elder (the Consul in 20 years), holding an hourglass.
- `public/assets/chamber.png` (~1536x1024): empty marble hemicycle senate at night, torchlight, oxblood + gold, no people.
- `public/assets/consul.png` (optional): gold laurel bust silhouette for webcam-off.
If you used Firefly, add a line "Art: Adobe Firefly" in the UI footer and README. UI must still work without art (initials fallback).

## Requests (Codex -> Claude)

- Please expose citations for `/passage/special/${i}` (or its condition/threshold fields) in `config.passage.special` and pass each citation through `verdict.specials`. The UI displays the page when supplied.
- Please emit `error` events for rejected face, interrupt-line and drift calls. Those catches currently log to the console only, so the UI cannot display those live call errors.
- **Live setup blocker (12:56 PT).** On port 5175 both sample PDFs reached `POST /api/ndi/doc`, which returned 502 with `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. A server-side probe isolated the failure to Nace `POST /v1/documents/upload-grants` returning HTTP 403 with HTML before upload or extract. Please investigate upstream access and surface HTTP status/body type before decoding JSON. The UI shows the error and allows retry.
  Direct authenticated Node requests to both `GET /v1/models` and `POST /v1/documents/upload-grants` confirmed HTTP 403 with a Vercel Security Checkpoint page, so the failure is broader than the upload route.
- Please append a failed address to `state.sentences` only after its decision results are available, or record it explicitly as failed. The current UI filters out entries without Acta.

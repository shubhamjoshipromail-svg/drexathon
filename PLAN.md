# The Cabinet: build plan

Deadline: **hard submit 3:00 PM PT, 2026-11-14**. Finalist demo: 5 min live. Aim to have it submitted by 2:45.

## Ground rules
- **No faking.** Every number, vote, citation and reaction on screen comes from a real NDI / Drex / LLM call or real code. Any shortcut that shows something not computed live (cached results, canned lines, scripted fallbacks) must be **named to the user and approved before it is used**. Log approved ones in the table at the bottom.
- Speed over polish. No auth, no DB, no build step, no framework. Plain Node `server.mjs` + browser JS.
- Read `COORDINATION.md` before changing files; claim files there.

## Product (one line)
**A parliament for your decisions.** You bring a real decision ("Should I quit my job for the startup?"). Your *constitution* (a values note / team charter, read by NDI) sets up the government: which ministries exist, what each protects, who has veto, what thresholds apply. Your *evidence* (offer letter, lease, PRD) is read by NDI so ministers argue from cited facts. You argue out loud; a webcam reads your face. Every agent decides independently via Drex after every sentence. The engine enforces the constitution's powers in code. Output: verdict, conditions, dissent with citations, support curve, gut readout.

Tracks: **Swarm** (Drex makes every agent's call) + NDI bonus. LLM (OpenAI, model `gpt-6-luna`, env `OPENAI_MODEL`) is only the ministers' *mouth*.

## What already exists (reuse)
- `server.mjs`: static server + proxies `/api/drex`, `/api/llm`, `/api/ndi/extract`, `/api/ndi/manual` (PDF bytes -> upload grant -> upload -> extract). Keys in `.env` (`NACE_API_KEY`, `OPENAI_API_KEY`).
- `public/` (Shout Command game): reusable pieces = Web Speech voice input, packed Drex calls, NDI upload. Move the game to `archive/shout-command/` (it is the fallback), then build the new app in `public/`.
- `experiments/FINDINGS.md`: measured API behaviour. Key facts: `choice` uses `criteria: {key: desc}`; pack many questions in ONE request (50 q = 660 ms) instead of parallel requests (in-flight cap queues them); Drex Max reads images (~0.3 s); NDI extract on a scanned 2-page PDF ~10-20 s with page citations; give each agent only the rules that apply to it (sharing all rules made Drex over-apply them).

## Agents and decisions
| Agent | Count | Per sentence, Drex decides |
|---|---|---|
| Minister (one per ministry from the constitution) | 5-8 | `stance` score (5 levels: strongly against .. strongly for); `interrupt` noul; `cite` choice over its rule/fact ids + none; `condition` choice over candidate conditions + none; `ally` choice over other ministers + none |
| Caucus member (variants of each ministry: short/long-term, cautious/bold, etc.) | ~150 total | `support` score (5 levels) |
| Swarm drift (every ~3 s, even while silent) | 50 sampled caucus members | `support` re-scored given own minister's stance + neighbours' mean |
| Webcam (per sentence, toggle) | 1 frame | Drex Max `choice` over excited / anxious / unsure / determined / neutral; result enters every agent's state as "while saying X, the leader looked Y" |
| Final vote | ministers | `vote` choice yes / no / yes_with_condition; veto ministers also `in_scope` noul (does this decision fall under my veto scope?) |

Authority is **code**: vote weights, veto, thresholds, leader override come from the NDI-extracted constitution and are applied by the engine, never by a model.
LLM use: (a) at setup, propose 3 candidate conditions per ministry from its rules + evidence (Drex then chooses among them); (b) one spoken line for a minister when Drex says `interrupt` (browser `speechSynthesis` reads it). Nothing else.

## Data contracts
```js
// NDI extract schema -> constitution config
{ ministries: [{ name, mandate, protects, vote_weight, has_veto, veto_scope }],
  rules: [{ id, text, applies_to /* ministry name or 'all' */ }],           // + page from citations
  passage: { default_threshold /* simple|three_fifths|two_thirds|unanimous */, special: [{ condition, threshold }] },
  leader: { can_override_veto, override_requires } }
// NDI extract schema -> evidence
{ facts: [{ id, fact, topic }] }                                          // + page from citations
// Engine state
minister = { id, name, mandate, weight, veto, vetoScope, rules: [], stance: 0..4, vote, condition, ally, history: [] }
member   = { id, ministry, traits: 'long-term, cautious', seat: { x, y }, support: 0..4 }
sentence = { i, text, t, face, ministerDeltas, caucusMeanByMinistry }
```

## Phases (timeboxed; each ends with a visible check)
**P0 Gates (15 min). Stop and tell the user if any fails.**
1. Write `samples/constitution.pdf` (personal constitution template: 6 ministries, 2 with veto, a 2/3 rule for big money, leader override rule) and `samples/offer-letter.pdf` (startup offer: salary, equity, 1-year cliff, runway). Generate with Python/PIL like `scripts/make_manual.py`.
2. NDI extract both with the schemas above. Pass = ministries, vetoes, thresholds and facts correct, with pages.
3. Drex: one request with ~150 caucus `support` questions on a sample sentence. Pass = < ~2 s and the variants actually split (not all the same answer).
4. Drex Max on a real webcam frame in the browser. Pass = sensible emotion, < 1 s.

**P1 Engine (40 min).** `public/engine.js`: load configs, generate agents (code, no LLM), per-sentence pipeline (ministers call + caucus call in parallel + webcam call), drift loop, vote + authority enforcement, verdict object. Test from the console with typed sentences.

**P2 UI (35 min).** Can go to Codex in parallel against the contracts above (`public/view.js`, `public/index.html`, `public/style.css`). Hemicycle canvas of caucus seats coloured by support and grouped by ministry; minister cards (stance bar, vote, condition, citation with page, interrupt bubble); transcript + mic (hold Space); webcam preview + face label; support curve per sentence; setup screen (upload constitution + evidence, or use samples, and type the decision); verdict screen.

**P3 Voices + conditions (20 min).** LLM interrupt lines + speechSynthesis; you accept/reject a minister's condition by voice (Drex classifies the reply against the open conditions).

**P4 Assets + fun mode (20 min).** Minister portraits / chamber background via OpenAI image API (headless). Optional: load a real country constitution as the government (only if time).

**P5 Ship (20 min).** Demo script ("Should I quit my job for the startup?"), rehearse twice, record a backup screen video, README run steps, commit, submit.

## Demo script (draft)
1. Upload constitution + offer letter. Government forms on screen with cited powers (NDI).
2. Say the decision. Argue for it out loud. Seats and ministers shift each sentence; Health interrupts citing your sleep rule; webcam catches you looking anxious about runway.
3. Accept Finance's condition by voice. Call the vote. Engine applies the 2/3 rule and Health's veto. Verdict + dissent + gut readout.

## Decisions (12:40, user approved "go")
- Theme: **The Senate of You** (Roman): senators in togas, veto holders = Tribunes, you = Consul at the rostrum (webcam), vote = Divide the Senate. Data overlays stay modern. Full spec in `CODEX_P2.md`.
- P2 UI + all art -> Codex (its own image gen, or Adobe Firefly web via computer use). No OpenAI image API.
- Explainability: **Acta Senatus** = per sentence the exact context, every question and raw Drex answer (engine stores it; UI shows it on click).
- Value vs one LLM: verdict screen runs **one LLM call** on the same inputs, code checks it against the constitution (made-up rules, missed vetoes, threshold). Shown side by side.
- Floor speeches enter other agents' context only as structured positions (cite + condition), never the LLM's words.
- Direction test (`experiments/test_direction.mjs`): 6/6 senators moved the expected way (12:44).

## Approved shortcuts (user must approve each)
| Shortcut | Approved? |
|---|---|
| (none yet) | |

# Drexathon

Our project for the [Nace.AI Drexathon](https://www.nace.ai/drexathon).

- Sponsors on the event page: Adobe, DeepInfra
- Submit: https://www.nace.ai/drexathon/submit
- Discord: https://discord.gg/nace-ai

## The Cabinet: a parliament for your decisions
Bring a real decision ("Should I quit my job for the startup?"). Your **personal constitution** (PDF) is read by **NDI**: it creates the ministries (Finance, Health, Family...), their vote weights, vetoes, passage thresholds and the leader's override rule, every item with a page citation. Your **evidence** (an offer letter) is read by NDI into cited facts. Then you argue out loud. After every sentence, **Drex** decides independently for 6 ministers (stance, interrupt?, which rule/fact to cite, which condition to demand, ally, did you just accept a condition?) and ~150 caucus members (support), in two packed calls (~0.6 s + ~1.8 s). A webcam frame goes to **Drex Max** (~0.3 s) so the cabinet knows you looked anxious while saying it. The caucus keeps drifting every 3 s (swarm). When you call the vote, Drex casts the votes and judges veto scope and which threshold applies; **the engine enforces authority in code** (weights, 2/3 rule, vetoes, override conditions). The LLM (OpenAI) is only the ministers' mouth and drafts candidate conditions; it decides nothing.

Tracks: Swarm + NDI bonus. Engine: `public/engine.js`. Fallback game: Shout Command at `/archive/shout-command/`.

## Run
```bash
bash scripts/setkeys.sh   # NACE_API_KEY, OPENAI_API_KEY into .env
node server.mjs           # http://localhost:5173 in Chrome (voice + webcam)
```
Click "Use samples" (`samples/constitution.pdf`, `samples/offer-letter.pdf`; regenerate with `python3 scripts/make_samples.py`) or upload your own PDFs, type the decision, wait for NDI (~20-30 s), then hold Space and talk. Call the vote when done.

Checks without the UI: `node experiments/gate_drex.mjs` (150 caucus decisions in one call), `BASE=http://localhost:5173 node experiments/test_engine.mjs` (full pipeline: NDI, sentences, drift, vote). Measured numbers: `experiments/FINDINGS.md`.

## Demo script (5 min)
1. Setup: "Use samples", decision "Should I quit my job to join Lumen Labs as founding engineer?". While NDI reads, explain: the constitution creates the government. Show the formed government: weights, Health + Family vetoes, 2/3 rule for job changes, all with page numbers.
2. Webcam on. Say: "I'm bored at my job and this is exactly the scary bet I promised myself once a year." Adventure jumps; the Ambition/Adventure seats go green.
3. Say: "Honestly I'd sleep five hours a night for a year if that's what it takes." Health drops and interrupts out loud, citing the 50-60 hour weeks (offer letter p1) / sleep rule.
4. Say: "I'd keep living here with Sam and fly to Austin three days a week." Family reacts (veto scope: moving cities). Stay silent a few seconds: the caucus keeps drifting.
5. Accept a condition out loud (e.g. "OK, I agree to cap my weeks at 55 hours"). Drex marks it accepted.
6. Call the vote. Show: share vs the 2/3 threshold (and why it applies), Health's veto and whether override is allowed (needs 2/3 + Health's condition accepted), conditions, dissent with citations, support curve, gut readout.
Everything is live; results differ run to run. That is the point: they are computed, not scripted.

## Team / agents
See [COORDINATION.md](COORDINATION.md) before changing anything.

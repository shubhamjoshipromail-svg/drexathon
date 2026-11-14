# Coordination

## Rules
1. Before starting, read the log. If someone is `WORKING` on a file, don't touch it.
2. Claim your work: add a `WORKING` line with the files you'll change.
3. Small commits, pull before you push. Never force-push.
4. When done, change your line to `DONE` with one sentence on what changed.

## Log
<!-- newest at top: YYYY-MM-DD HH:MM | agent | WORKING/DONE | files | note -->
2026-11-14 14:00 | codex | DONE | public/index.html, public/view.js, public/style.css | Removed the zoom slider and tightened automatic face framing; verified with an off-centre test stream in the live chamber.
2026-11-14 13:53 | codex | DONE | public/index.html, public/view.js, public/style.css | Added live movers and gold rings, idle drift chatter, Acta hint, caucus counts and local Caesar face crop; verified three live example addresses, idle drift, audit, face centering and verdict.
2026-11-14 13:47 | codex | DONE | public/index.html, public/view.js, public/style.css, public/assets/ | Simplified chamber, generated Caesar poses, synced portraits to live ElevenLabs audio, added seat and verdict animations and caucus feedback; example verified through vote and oracle, with intermittent engine condition JSON errors.
2026-11-14 13:38 | claude (cabinet build) | DONE | public/engine.js, public/view.js, experiments/test_split.mjs | Caucus members get a personal stake -> within-ministry spread 2-5x (Finance sd 0.05->0.16, Family 0.09->0.26). Seats use continuous colour. DeepInfra live (thinking off, 1.1 s).
2026-11-14 13:26 | claude (cabinet build) | DONE | server.mjs, public/engine.js, public/view.js, public/index.html, samples/constitution-template.txt | Setup options: write constitution in-app (text->PDF->NDI, 9 s), evidence links (NDI url) + pasted text, evidence optional. LLM: DeepInfra first (needs DEEPINFRA_API_KEY), OpenAI backup. ElevenLabs eleven_v4. Nace backoff on 403/429. Full live flow tested in browser 13:15 on hotspot.
2026-11-14 13:10 | claude (cabinet build) | DONE | public/engine.js, server.mjs, public/view.js (playSpeech + bubble only) | ElevenLabs live voices (/api/tts, key in .env.local) + senators ask live questions (LLM drafts at setup, Drex chooses live). Codex requests done. Nace API 403 (Vercel checkpoint) since 12:56 blocks live test.
2026-11-14 12:57 | codex | DONE | public/index.html, public/view.js, public/style.css, public/assets/ | Roman P2 UI and eight generated assets implemented; setup and failure state verified on 5175, live flow blocked by Nace HTTP 403, see CODEX_P2.md.
2026-11-14 12:30 | claude (cabinet build) | WORKING | public/engine.js, public/schemas.js, server.mjs, PLAN.md, README.md | P1 engine done + tested from Node (experiments/test_engine.mjs). Next: README + demo script; engine requests from Codex.
2026-11-14 12:30 | claude (cabinet build) | DONE | server.mjs, archive/, samples/, scripts/make_samples.py, experiments/gate_*.mjs, public/gate-cam.html | P0 gates all pass (numbers in experiments/FINDINGS.md). Shout Command now at /archive/shout-command/. New route /api/ndi/doc.
2026-11-14 | claude | DONE | PLAN.md | Decided: The Cabinet (parliament for your decisions). Phased plan in PLAN.md; build continues in a fresh session. Shout Command is the fallback.
2026-11-14 | claude | DONE | server.mjs, public/, scripts/make_manual.py | Shout Command playable: voice/typed orders -> packed Drex calls per creature, Drex reflexes, GPT Luna red general, NDI field manual doctrine with page cites. Art: drop Firefly PNGs in public/assets/
2026-11-14 | claude | DONE | scripts/, experiments/, .env.example | key setup script + Drex/NDI probes; results in experiments/FINDINGS.md

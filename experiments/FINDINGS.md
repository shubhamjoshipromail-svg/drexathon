# Drex / NDI probe findings (2026-11-14)

Scripts: `probe.mjs` (text), `probe2.mjs` + `make_imgs.py` (images, NDI). Key in `.env` as `NACE_API_KEY`.

| Test | Result |
|---|---|
| drex-v2.0 latency | model ~50 ms, round trip ~230 ms |
| drex-max-v1.1 latency | model ~190 ms, round trip ~300-500 ms |
| 30 parallel requests | all 200 OK, but wall time 7.6 s: an in-flight cap queues them. Don't fan out requests. |
| 50 questions in ONE request | 660 ms round trip, 50/50 correct. Pack every agent into one call (max 512 questions). |
| Messy order -> per-unit action (8 orders x 5 units) | Max 39/40, v2.0 37/40 |
| Images (Drex Max, 640x480 jpeg) | 4/4 poses correct, ~250-370 ms round trip, so about 3 decisions/sec from a webcam |
| NDI extract from a URL PDF (15 pages) | 7.6 s, correct values, citations with page + polygon. Setup-time only, not in the live loop. |

## The Cabinet P0 gates (12:30 PT)
| Gate | Result |
|---|---|
| NDI constitution.pdf (2-page scan) | 26.9 s. 6/6 ministries, weights 2/1/1/2/1/1, vetoes Health + Family with exact scope, simple default + 2/3 special, leader override + requirement, 7/7 rules with owner. Every item cited (ministries p1, rules/passage/leader p2). `passage/special` has no citation. |
| NDI offer-letter.pdf | 17.8 s. 23 facts, all correct, pages correct (p1/p2). Includes trivia (company name, signatory). |
| Drex 150 caucus `score` in 1 request | 1.03-1.11 s round trip (~0.6 s eval). Ministries split widely (Health 0.7 .. Adventure 3.2 of 4). Within a ministry: temperament splits Ambition/Adventure (sd ~0.3, cautious 1.7 vs bold 2.5) but Finance/Health/Family barely move (sd ~0.05). Sentence 2 (sleep 5 h, Austin) moved Health 0.80->0.69, Family 0.83->0.70, Ambition 2.15->2.57. |
| Drex Max webcam (real Chrome frame, 5 reads) | PASS on speed: 298-454 ms round trip, 143-195 ms eval. person noul 0.96. face = determined all 5, but conf only 0.23-0.29 of 5 options: show the probability bars, not just the label. |

API notes:
- `choice` takes `criteria: {key: description}`, not `options`. `score` takes `criteria: [levels]`.
- NDI url source needs `file_name`. Use `?wait_seconds=60` to get the result in the same call.
- Browser runs exist (`POST /v1/browser/runs`): a Drex Max agent browsing allowed sites.
- No LLM baseline key yet.

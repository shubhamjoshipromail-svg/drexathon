# Codex task P3: visual polish for the demo (timebox: done by 2:10 PM PT, commit locally, do NOT push)

Same rules as CODEX_P2.md: you own `public/index.html`, `public/view.js`, `public/style.css`, `public/assets/`. Claude has edited view.js since your commit (ElevenLabs `speakLine`, setup text/link/paste fields, `blend()` seat colours): pull those in, don't revert them. Don't touch engine.js / server.mjs / schemas.js. NO FAKING still applies: animations are decoration, every number/vote/line still comes from the engine. Run `node server.mjs` (or PORT=5175). Test the full flow with "Use the example" before committing. Log in COORDINATION.md.

## 1. Remove the "AI-generated" look (most important)
It must look like a designed product, not a template. Concretely:
- Delete decorative filler: the "S" coin logo, repeated gold eyebrow labels ("THE SENATE OF YOU" above "Convene the Senate", "THE MOTION", "CAUCUS SUPPORT"), glows, gratuitous gradients, emoji/unicode ornaments (♜, ● pips, ⟷).
- Fewer, bigger things. One clear hierarchy per region: the motion, the hemicycle, the speaking senator, you. Cut tiny 10px meta lines; show detail only in the Acta popover. Max 2 font sizes per card.
- One accent colour (gold) used sparingly; ministry colours only on the seats/stance bars. Flat dark background with the chamber image subtle (low opacity), no vignette stacks.
- Plain, confident copy. Sentence case except the Cinzel motion title and the verdict. No "·"-chains of metadata.
- Senator cards: portrait large (it's the character), name, one stance bar, current demand (if any). Citation as one quiet line. That's it.

## 2. Speaking animation (simple, not much)
When a senator speaks (interrupt or question, i.e. while its ElevenLabs audio plays): the card lifts and scales slightly, the portrait does a gentle talking bob driven by the audio level (WebAudio AnalyserNode on the <audio> element: `speakLine(base, text, voice, onAudio)` now calls `onAudio(audioEl)` before playback and resolves when it ends), a small sound-wave indicator next to the name, and the speech bubble pops in. Others dim a little. Ends when audio ends.
Optional if fast: a "speaking/gesturing" portrait variant per senator (same style, hand raised mid-speech) swapped in while speaking: `assets/ministers/<slug>-speaking.png`.

## 3. You as Caesar (fun, memorable)
Replace the webcam box with a **Caesar body**: an illustrated Roman consul in a toga with a laurel wreath, painted in the same style as the senators, with the **face area left as an oval cut-out**. Put the live webcam video behind/inside that oval (CSS mask / clip-path, object-fit cover, slightly scaled to the face), laurel wreath PNG layered on top of the head. Camera off → a marble bust face in the oval. Asset: `assets/consul-body.png` (transparent PNG, oval hole or a separate `consul-wreath.png` overlay). Keep the face label + mic indicator small under it. While you speak (Space held), the Caesar raises an arm (swap to `consul-body-speaking.png` or a CSS transform on a separate arm layer). Keep it funny but not cheap.

## 4. Two small "moments" (only if time)
- Division: the verdict stamp lands with a short scale+shake animation; a veto seal drops onto the result.
- Seat ripple: when a sentence result arrives, seats update in a sweep from the rostrum outward (stagger by distance), so the swarm visibly reacts.

## 5. Show the caucus feedback (small, required)
The engine now feeds each senator its caucus lean, and `verdict.votes[]` has `caucus: {against, for, n, mean}` and `defiesCaucus` (bool). In the vote table show "caucus 18/25 against" per senator, and a small "defied its caucus" mark when `defiesCaucus` is true (display only, it does not change the outcome).

Don't add features beyond this. When done: list what changed in COORDINATION.md and tell the user.

# Codex task P4: make the goal obvious + constitution wizard (finish in ~30 min, commit locally, don't push)

Same ownership/rules as before (index.html, view.js, style.css, assets; NO FAKING; keep Claude's view.js changes; don't touch engine.js/server.mjs/schemas.js). The UI must answer at every moment: what is happening, what do I do, what is the goal, when am I done.

## 1. Three-step guide (top of page, always visible)
`1 Form the Senate → 2 Make your case → 3 Divide the Senate`, current step highlighted. Under the motion one sentence of the goal: "Win the Senate's vote under your constitution: you need {coach.need as %} ({coach.reason})."
First time in the chamber: a 3-line dismissible intro: "You are the Consul. Your constitution formed this Senate. Argue out loud: after every sentence every senator and 150 caucus members decide via Drex. Answer their questions, accept or refuse their amendments, then divide the Senate."

## 2. Coach panel = "What next" (replace the bare tally area or sit under the motion)
Engine now has `engine.coach()` and emits `'coach'` after every sentence (call it yourself after 'accepted', 'drift', 'verdict' too). Shape: `{threshold, reason, need (0..1), projected (0..1), yesWeight, total, vetoRisk[{short,scope,demand,stance}], persuadable[{short,weight,stance,demand,cite}], openQuestion, openConditions[{from,text}], steps[string], ready, decided, note}`.
Show: a bar of `projected` vs the `need` line (label "projected from current Drex stances, not a vote"), then `steps` as a short numbered list (max 3, first one bold), veto risks as red chips, persuadable senators as chips (click → their Acta). When `ready` is true make "Divide the Senate" glow. The tally threshold must use `coach.threshold` (engine now judges the special threshold at start, so it says 2/3 for the job sample from the first sentence, not "simple").

## 3. NDI cache label (setup progress lines)
`readConstitution/readEvidence/...` results now include `cached` (bool), `cachedAt` (ISO), `liveMs`. If cached show: "NDI read constitution.pdf · cached from 13:12 (live read took 27.5 s)". Add a small checkbox on setup "Re-read documents live" that calls `setNdiFresh(checked)` (export from engine.js) before reading.

## 4. Create your constitution (wizard), alternative to the template textarea
A "Build my constitution" button on setup opens a short wizard (one screen, no AI):
- "What matters to you?" choose 3-7 from: Finance, Health, Family, Career/Ambition, Adventure, Future Self, Friends, Learning, Faith, Community, Creativity + custom. For a team/org: Product, Engineering, Customers, Legal, Budget, Team.
- For each chosen: one line "what it protects" (prefilled sensible text), weight 1-3, veto yes/no + "veto over" text, one rule (prefilled example).
- Passage: simple / 3/5 / 2/3 / unanimous; optional special rule ("decisions risking more than $__ need __"); leader override yes/no + condition.
The wizard renders plain text in exactly the template format of `samples/constitution-template.txt` (Article 1 ministries with "Vote weight: N" + "Holds a VETO over ...", Article 2 rules "Rule 2.N (Ministry). ...", Article 3 passage, Article 4 leader) into the constitution textarea; the user can edit it; NDI reads it as usual. Copy: "Your answers become your constitution. NDI reads it like any document."

Test: "Use the example" flow + one wizard-built constitution end to end. Commit locally, log in COORDINATION.md.

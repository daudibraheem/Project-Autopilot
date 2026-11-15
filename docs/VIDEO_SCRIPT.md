# Video script — Autopilot Scrum Agent (3–5 minutes)

Record in **mock mode** (no API key, no internet). Start at **http://localhost:3000/?presenter=1** so the 7-step presenter bar is on. Use **→ / ←** to move between steps and **R** to reset. Window at **1920×1080**.

**Before recording:** `pnpm demo` then `pnpm cli seed-sprint` (or just press **R** / "Reset demo" in the presenter bar). This gives a clean starting state every time.

Narration is one or two plain sentences per step. The presenter bar navigates and spotlights the right area for you.

---

**Step 1 — Team health at a glance**
> "This is a control room for a software team. In one screen you see today's standup, any stuck work, the odds of finishing the sprint, and the health of the code — all checked by plain code, not guessed by an AI."

**Step 2 — Run the morning routine**
> "One button runs the whole morning scrum. Watch it go: it checks the goals, finds stuck work, an AI drafts the standup, a *different* AI verifies every claim, a plain-code safety gate has the final say — and then it stops and waits for me. Nothing is sent automatically."
>
> *(Click "Run morning routine" and let the pipeline play. When it finishes, a toast says the brief and nudges are ready.)*

**Step 3 — The sprint board**
> "Humans and AI agents work on the same board. Anything stuck is flagged with a plain-English reason — here, this item is blocked because the build is failing. The AI only ever saw pseudonyms; the real names you see are added in the browser."
>
> *(Hover "Why is this flagged?" on a stuck card.)*

**Step 4 — The standup brief**
> "Here's the brief the AI wrote. Every sentence ends in a source you can click. The model worded the facts — it never chose a number; the counts are recomputed by code. And here's a preview of how it would look in Slack — but it's only a preview."
>
> *(Open a source chip; then click "Preview in Slack".)*

**Step 5 — Approvals**
> "Nothing reaches the team without me. I can see the checks that passed — the gate and the verifier — then approve the brief. The nudges are drafts: approving one copies it to my clipboard to send myself. Autopilot has no send button."
>
> *(Approve the brief; approve one nudge and point out the "copied, not sent" toast.)*

**Step 6 — Scope change**
> "Now the real world: a stakeholder adds work mid-sprint. Watch the forecast — it drops live from 68% to 52%, and a banner spells out what changed. No surprises at the end of the sprint."
>
> *(Click "Add mid-sprint item" on the Sprint page.)*

**Step 7 — Your AI teammates**
> "Each AI agent earns trust as its work is approved, shown as a simple meter. But some things always need a human: the nudge agent is locked at the lowest level by design. The gate — plain code — always has the final say."

---

**Closing line (optional):**
> "Same engine as our code assistant — standing goals, a worker, a different verifier, a plain-code gate, and a human in the loop — now keeping the *team's* work healthy, safely."

**Reset between takes:** press **R** or click "Reset demo" in the presenter bar.

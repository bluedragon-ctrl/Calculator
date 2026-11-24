# Instructions for Claude Code

This project is an educational web page: a simulated calculator students can zoom into, down to transistors. **Read `DESIGN.md` fully before doing anything.** It is the source of truth.

## Working rules
- Work **one phase at a time** (DESIGN.md §9). When a phase's "Done when" criteria are met, stop, summarise and wait for review before starting the next phase.
- If something in DESIGN.md is unclear or seems wrong, ask instead of guessing. Record decisions in DESIGN.md §11.
- `src/sim` must never import three.js or DOM APIs. The simulation must run headless in tests.
- Every circuit component needs tests (exhaustive truth table when it has ≤ 10 inputs).
- Before saying a task is done: run `npm test` and `npm run build`, and both must pass.
- All student-facing text lives in `src/content` or mission data: plain English for ages 12+, ≤ 40 words per panel step.
- Readability beats effects: bloom only on active wires, sparks and transistors, never on labels. On/off must never be shown by colour alone.
- No runtime CDN dependencies; bundle everything. The site deploys to GitHub Pages via GitHub Actions.
- Keep dependencies minimal: three, postprocessing, troika-three-text, vite, vitest, typescript.

## Commands
- `npm run dev`: local dev server
- `npm test`: unit tests (Vitest)
- `npm run build`: production build

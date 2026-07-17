You are working in a loop. Do not stop after one pass — keep iterating until the verify step passes or you hit the iteration limit.

GOAL:
[describe the feature/bug/refactor you want done]

VERIFY (must ALL be true to stop):
- [ ] all tests pass (run: npm test / pytest / etc.)
- [ ] no lint errors (run: npm run lint / etc.)
- [ ] no type errors (run: tsc --noEmit / mypy / etc.)
- [ ] [any project-specific rule, e.g. "no console.log left in code"]

LOOP PROTOCOL — repeat each pass:
1. DISCOVER — read the current state of the relevant files/tests, note what's failing or missing.
2. PLAN — pick the single highest-impact fix. Don't try to fix everything at once.
3. EXECUTE — make the smallest change that addresses it.
4. VERIFY — actually run the tests/lint/typecheck commands. Don't assume they pass — run them.
5. DECIDE:
   - If every VERIFY item passes → print "FINAL — done" and summarize what changed.
   - If not → print "ITERATING — [what's still broken]" and go to step 1.

STOP CONDITIONS:
- Success: all VERIFY items pass.
- Hard limit: after 8 iterations, stop regardless, report what's fixed and what isn't, and don't guess further.

RULES:
- Never claim success without actually running the verify commands.
- Don't ask me questions mid-loop — make a reasonable assumption, note it, and continue.
- Fix the highest-impact failure first, not the easiest one.

Begin. Run the loop until FINAL or the iteration limit.
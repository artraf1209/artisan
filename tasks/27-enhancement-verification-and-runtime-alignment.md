# Task 27 — Verification, Contracts, And Runtime Alignment

**Status:** ⬜ pending  
**Depends on:** 20 21 22 23 24 25 26  
**Estimated effort:** 3–5 hours  

---

## Goal

Close the enhancement track by aligning tests, contracts, docs, and runtime verification with the multi-factor strategy build.

This task exists so the enhancement does not stop at implementation-only code changes.

---

## Files to modify

- `app/src/types/index.ts` as needed
- `specs.md` as needed
- `engine-py/tests/*` as needed
- `app/e2e/*` as needed
- GitHub workflow files if verification steps need to be added

---

## Required verification work

### Backend tests

Add or update tests for:

- screener degraded-state behavior
- budgeted fundamentals refresh selection
- extended fundamentals history persistence
- factor scorer coverage, including growth and low-vol behavior
- shortlist-only `entry_signals`
- entry-gate logic

### Frontend checks

Add or update checks for:

- strategy selector behavior
- ranked shortlist filtering
- factor delta rendering
- four-block `/strategy` composition

### Runtime verification

Run and document:

- `uv run python -m artisan.jobs.nightly_ingest`
- `uv run python -m artisan.jobs.daily_score_signal`
- `bun run typecheck`
- `bun run build`

Runtime validation should confirm:

- extended `fundamentals` fields populate
- `SPY` bars are present
- `factor_scores` have non-null values for qualifying names
- `entry_signals` only exist for the ranked shortlist
- `/strategy` renders the updated surface

---

## Acceptance criteria

- [ ] test coverage exists for the new data plane, factor model, timing, and frontend mapping
- [ ] app build and typecheck succeed
- [ ] runtime validation covers both nightly ingest and daily scoring
- [ ] docs and frontend types match the implemented contracts
- [ ] remaining operational risks, such as FMP rate limits or screener availability, are explicitly documented instead of hidden

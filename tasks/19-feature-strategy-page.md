# Task 19 — Original Strategy Page Task (Superseded)

**Status:** ⬜ pending  
**Depends on:** 01 (migration — goal columns in strategies), 11 (signal_events exist), 15 (portfolio_positions populated)  
**Estimated effort:** historical only  

---

## Note

This task described the original Strategy page build built around:

- `GoalPanel`
- `UniverseThesis`
- a static 10-symbol universe
- the legacy three-pillar F/T/S model only

That plan no longer matches the current requirements in [specs.md §9](../specs.md#9-strategy-page--multi-factor-enhancement).

The current requirements now call for:

- a four-block `/strategy` page
- dynamic screened universes
- `factor_scores` and `entry_signals`
- sector-neutral multi-factor scoring
- shortlist-only entry timing
- strategy-scoped pipeline rendering

---

## What To Use Instead

Do not start new implementation work from this task.

Use the multi-factor enhancement track instead:

- [Task 20 — Factor layer migration](./20-enhancement-factor-layer-migration.md)
- [Task 21 — Dynamic universe screener + budget controls](./21-enhancement-screener-budgeted-universe.md)
- [Task 22 — Extended fundamentals history + SPY ingest](./22-enhancement-fundamentals-history-and-spy-ingest.md)
- [Task 23 — Factor scoring suite](./23-enhancement-factor-scoring-suite.md)
- [Task 24 — Technical enrichments + entry gates](./24-enhancement-technical-entry-gates.md)
- [Task 25 — Daily score + signal multi-factor orchestration](./25-enhancement-daily-score-signal-multifactor.md)
- [Task 26 — Strategy page multi-factor frontend](./26-enhancement-strategy-page-multifactor.md)
- [Task 27 — Verification, contracts, and runtime alignment](./27-enhancement-verification-and-runtime-alignment.md)

---

## Historical Scope

Keep this file only as a pointer for older references in commits, chats, or branch notes. The active source of truth is:

- [specs.md §9](../specs.md#9-strategy-page--multi-factor-enhancement)
- Tasks 20–27 in this folder

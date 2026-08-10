# v2-23 — /briefings Page

**Depends on:** v2-01, v2-13
**Touches:** `app/src/app/briefings/page.tsx` (existing — rewritten for the new schema), `app/src/components/briefings/BriefingList.tsx`, `BriefingCard.tsx` (existing — updated), `app/src/app/api/briefings/route.ts` (existing — rewritten)

## Context

`/briefings` already exists, backed by `llm_analyses` filtered to `analysis_type='briefing'` — that table is dropped in v2-01, replaced by the dedicated `briefings` table (v2-13 writes to it). This task updates the page and its API route to the new schema's richer structured fields (`regime_line`, `urgent_flags`, etc.) instead of a single opaque `content` text blob.

## Scope

### `app/src/app/api/briefings/route.ts` (rewrite in place)

Query `briefings` ordered by `briefing_date` descending, instead of `llm_analyses`.

### `app/src/components/briefings/BriefingList.tsx` (update)

List view: date, `regime_line`, an `urgent_flags` count badge (red if non-empty).

### `app/src/components/briefings/BriefingCard.tsx` (update) / expanded view

- Urgent flags rendered prominently at the top (if any), each as its own callout.
- `regime_line`.
- `new_recommendations_summary`.
- `position_actions_summary`.
- `outcomes_note` (resolved shadow + real `decision_outcomes` from that run).
- `portfolio_state_line`.
- `full_text` rendered as formatted markdown below the structured summary fields.
- Recommendation symbols mentioned in the summaries link to `/history?symbol=<SYM>` (v2-20).

## Verification
1. `cd app && bun run build` passes.
2. With a real `briefings` row (from a v2-14 pipeline run via v2-13), load `/briefings`, confirm the list and expanded card render all structured fields correctly.
3. Confirm a briefing with a non-empty `urgent_flags` array renders the callout(s) prominently, and one with an empty array shows no callout.
4. Click a symbol link from a summary field, confirm it navigates to `/history` pre-filtered to that symbol.

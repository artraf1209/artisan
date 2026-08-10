# v2-24 — Telegram Bot Notifications

**Depends on:** v2-01, v2-13
**Touches:** `bot/src/` (existing — extended, not rewritten)

## Context

The bot's architecture (grammY, Supabase access, edge function hooks) is already sound and was deliberately built to support richer commands later. This task is primarily a data-model alignment pass — the pause mechanism moves off the (dropped) `logs`-table sentinel hack onto the new `strategies.paused_until` column, and the push-notification payload shape changes to match the new `briefings` table.

## Scope

### Push notifications (triggered by `send-alert`, called from v2-13's Briefing agent)

- New briefing available: format and send `urgent_flags` (prefixed with ⚠️ per flag), `regime_line`, `new_recommendations_summary`, `portfolio_state_line`. Do not send `full_text` — link back to the `/briefings` page instead (or state "see dashboard for full briefing" if no public URL is configured).

### Commands (existing — verify against the new schema, update queries as needed)

- `/status` — current regime (from `regime_snapshots`, latest), portfolio equity and `drawdown_from_high_pct` (from `portfolio_snapshots`, latest), open positions count (from `portfolio_positions`).
- `/trades` — list open positions with `unrealized_pnl` (from `portfolio_positions`, joined with latest `price_bars` if `current_price` isn't kept fresh).
- `/pause` — `UPDATE strategies SET paused_until = <user-specified duration, or a long default> WHERE id = ...`. This replaces the old `process-signal` pause-sentinel hack that read a magic "PAUSED" message from the (now-dropped) `logs` table — `process-signal` itself is deleted in this rebuild, so that mechanism is gone entirely. The daily pipeline's `score.py` job (v2-14) should check `strategies.paused_until` at the very start and skip straight to a no-op completion (still creating a `pipeline_runs` row marked accordingly) if currently paused.
- `/resume` — `UPDATE strategies SET paused_until = NULL`.

## Verification
1. Trigger a test briefing (via a manual v2-14 pipeline run), confirm the Telegram message arrives with the expected condensed fields and correct ⚠️ formatting when `urgent_flags` is non-empty.
2. Run `/status` and `/trades` against real data, confirm output matches the DB directly.
3. Run `/pause`, confirm `strategies.paused_until` is set; trigger `daily_pipeline.yml` and confirm `score.py` short-circuits without running the rest of the pipeline; run `/resume`, confirm normal operation returns.

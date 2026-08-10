# Artisan — Frontend Requirements Specification (v3 addendum)

## Status: Implementation-ready — additive to `artisan-v2-spec.md`
## Supersedes: nothing in the backend/data model. This document does not change §1–§15, §18–§20 of `artisan-v2-spec.md`. It replaces §16 (Account, Execution & Order Management Interface) with a complete information architecture, and adds one new backend surface (agent model/prompt config, §7) that `artisan-v2-spec.md` left as file-based.

---

## 0. Why this document exists

The live app at `app-swart-zeta.vercel.app` is a v1 mobile-first PWA shell (`app/src/app/layout.tsx`, `Navbar.tsx`, `manifest.ts`, `offline/`, `logs/` — all from the original `feat: convert frontend into mobile-first PWA` commit) with v2 feature pages bolted on one route at a time (`v2-16` queue, `v2-17` positions/dashboard, `v2-18` account, `v2-19` orders, `v2-20` history, `v2-21` strategy, `v2-22` settings, `v2-23` briefings). Nothing in the v1 shell was redesigned to fit the v2 information architecture — it was retrofitted. That's the problem this document fixes.

### 0.1 Audit findings from the live app (2026-08-10)

| # | Finding | Evidence |
|---|---|---|
| 1 | The bottom nav (`Navbar.tsx`) hardcodes 6 destinations — Home, Orders, Queue, Signals, Briefings, Strategy — and has never been updated as pages were added. `/positions`, `/account`, `/history`, and `/settings` all exist and render correctly but are **not reachable from primary navigation at all** | `nav` array in `Navbar.tsx`; confirmed all 4 pages load fine when navigated to directly |
| 2 | The only way to reach the 4 orphaned pages is a pair of unlabeled circular icon buttons in the top-right corner, and **which two pages they link to changes on every screen** (clipboard+newspaper icons on `/strategy`, chart+clipboard on `/positions`, target+clipboard on `/settings`, chart+newspaper on `/account`) | Screenshots of `/strategy`, `/positions`, `/account`, `/settings`, `/briefings` |
| 3 | `/signals` is a **legacy v1 page** (`components/signals`, last touched by `feat: add signal status and narrative to signals tab`, pre-dating the v2 rewrite) still linked from primary nav, sitting next to `/strategy` which now does the same job with the actual v2 factor/timing model. Two "what should I look at" pages compete for the same nav slot | `app/src/app/signals`, `app/src/components/signals` vs. `artisan-v2-spec.md` §9 |
| 4 | The approval queue lives at `/trades/queue`, under a legacy `/trades/*` URL namespace, while every other v2 page (`/positions`, `/account`, `/orders`, `/history`, `/strategy`, `/settings`) is top-level. One inconsistent URL convention sitting in the middle of a consistent one | `Navbar.tsx` (`href: '/trades/queue'`) vs. sibling routes |
| 5 | The fixed bottom nav is `position: fixed` with no scroll-aware collapse, and on every page audited it visually sits on top of the last ~120px of page content (settings' risk-parameter rows, the account equity chart, the full briefing digest) | Screenshots of `/settings`, `/account`, `/briefings` |
| 6 | `PageShell.tsx` already carries a `fix: desktop rendering issue` commit — i.e. the retrofit is known to not adapt past a mobile viewport. There is no desktop-specific layout (sidebar, multi-column, persistent chrome) anywhere in the shell | `components/shared/PageShell.tsx` history |
| 7 | **No page anywhere exposes `agent_analyses`** — the Fundamental/Technical/Sentiment Analyst output that the v2 backend already computes and writes every run. `/briefings` shows only the synthesized digest text; `/trades/queue` shows the Synthesis output (thesis, conviction) but not the three analyst reads that fed it. The per-agent reasoning trail the backend already produces has no UI at all | `artisan-v2-spec.md` §2.2, §4 (`agent_analyses` table) vs. full audit of `/dashboard`, `/trades/queue`, `/strategy`, `/briefings`, `/history` |
| 8 | Agent model assignment and system prompts are file-based (`engine/artisan/agents/prompts/*.md`, §2.6 of `artisan-v2-spec.md`) — there is no runtime surface, DB-backed or otherwise, for changing either without a code deploy | `artisan-v2-spec.md` §2.6 |

None of this is a visual-design problem — the dark theme, type, and card system read as coherent and are worth keeping. It's an information-architecture and route-completeness problem: pages were shipped faster than the shell that was supposed to organize them.

### 0.2 What this document specifies

Four primary sections, matching what you described needing, each mapped onto the v2 data model and onto (mostly already-built) v2 pages so implementation is largely re-wiring and gap-filling rather than a rebuild:

| Your section | Backing v2 pages/tables | New in this doc |
|---|---|---|
| **Dashboard** | `/dashboard` (v2-17), `/account` (v2-18) | YTD goal tracking, per-symbol timeframe-selectable performance, unified summary |
| **Recommendations** | `/trades/queue` (v2-16), `/strategy` (v2-21), `agent_analyses` (unsurfaced) | Full agent-reasoning drill-down, deterministic-computation trace, shortlist-to-order narrative |
| **Briefing** | `/briefings` (v2-23) | Per-agent log, reverse-chronological, all 6 agents |
| **Strategy** | `/settings` (v2-22), `/strategy` (v2-21, factor config half) | Agent model + prompt editor (new backend table, §7) |

Plus a full navigation/IA rebuild (§1) that fixes the 8 findings above, and a backend gap list (§8) enumerating what has to exist server-side before each frontend requirement can be real rather than decorative.

---

## 1. Information Architecture & Navigation

### 1.1 Primary navigation — 4 destinations, not 6

Replace `Navbar.tsx`'s hardcoded array with 4 primary sections. Secondary pages fold into the section they logically belong to as tabs, not disappear:

| Primary nav item | Route | Absorbs (as tabs within the section) |
|---|---|---|
| **Dashboard** | `/dashboard` | `/account` (Account tab), `/positions` (Positions tab) |
| **Recommendations** | `/recommendations` (renamed from `/trades/queue`) | `/strategy`'s shortlist/timing blocks (Shortlist tab), `/orders` (Orders tab) |
| **Briefing** | `/briefing` | new per-agent log view; existing `/briefings` digest becomes the default tab |
| **Strategy** | `/strategy` | `/settings` (merged, not separate — see §6), new Agents tab (§7) |

`/history` (decision knowledge base) becomes a secondary destination reachable from both Recommendations (per-symbol "view history" link) and Briefing (per-agent "view precedent" link) rather than a 7th top-level item — it's a drill-down surface, not a daily-use one. `/signals` (legacy) is retired; its "model output before human review" purpose is now covered by the Recommendations → Shortlist tab.

Net result: 4 top-level destinations, each a multi-tab section, zero orphaned pages, zero duplicate purpose.

### 1.2 Layout requirements

- **Desktop (≥1024px):** persistent left sidebar (4 primary items + collapse control), content area with its own scroll, no fixed-position chrome overlapping content at any scroll depth. This is a hard requirement — finding #5/#6 above are the single most visible symptom of "the new build doesn't fit the old UI."
- **Tablet (640–1023px):** collapsible sidebar (icon-only by default, expand on tap).
- **Mobile (<640px):** bottom tab bar retained (it's a reasonable pattern here) but fixed to exactly 4 items, and every scrollable content area must reserve `padding-bottom` ≥ nav height + safe-area inset so nothing is ever obscured — this was violated on `/settings`, `/account`, and `/briefings` in the current build.
- Section-level tabs (Positions/Account within Dashboard, Shortlist/Orders within Recommendations, per-agent tabs within Briefing, Config/Agents within Strategy) render as a horizontal tab strip directly under the page header on all breakpoints, not as a second nav layer.
- Remove the two unlabeled circular icon-button "shortcuts" entirely. If a global action is needed (e.g. jump to Recommendations from anywhere), it belongs in the sidebar/tab-bar, not a floating icon whose destination changes per page.

### 1.3 Acceptance criteria

1. Every route in the current build (`/dashboard`, `/positions`, `/account`, `/orders`, `/history`, `/strategy`, `/settings`, `/trades/queue`, `/briefings`) has a documented destination in the new 4-section IA — none are dropped silently.
2. No fixed-position element overlaps scrollable content at any scroll offset, verified on `/strategy` (longest table), `/settings` (longest form), and `/briefing` (longest digest) at 375px, 768px, and 1440px widths.
3. A user can reach all 4 primary sections and every tab within them using only visible, labeled nav controls — zero undocumented icon-only shortcuts.

---

## 2. Dashboard

**Route:** `/dashboard` · **Tabs:** Overview (default) · Positions · Account

### 2.1 Overview tab — three required blocks, in order

**Block A — Current Portfolio Overview**

| Field | Source | Notes |
|---|---|---|
| Equity | live Alpaca account endpoint (server-side proxy, never client-side — see §8.6) | fallback to latest `portfolio_snapshots.equity` if Alpaca call fails, labeled "as of {snapshot date}" |
| Cash / Buying power | live Alpaca account endpoint | |
| Day P/L ($ and %) | live Alpaca account endpoint | |
| Open positions count + total unrealized P/L | `portfolio_positions` | links to Positions tab |
| Sector exposure | `portfolio_snapshots.sector_exposure` (jsonb) | small horizontal stacked bar, links to Positions tab filtered by sector |
| Current drawdown vs. `max_drawdown_tolerance_pct` | `portfolio_snapshots.drawdown_from_high_pct` vs. `strategies.performance_goals.max_drawdown_tolerance_pct` | render as a gauge/bar with the 18% tolerance line marked; color shifts (green → amber → red) as drawdown approaches tolerance, matching the halt semantics in `artisan-v2-spec.md` §5.4 |
| Kill-switch / halt state | derived: `daily_drawdown_kill_switch_pct` breach or `drawdown_tolerance_breach` veto active this run | if active, render a persistent banner ("New entries paused — drawdown tolerance reached. Nothing was auto-liquidated.") — must never be silently absent when true |

**Block B — Goal Performance (YTD)**

This is new; nothing in the current build computes or displays it.

| Field | Computation | Source |
|---|---|---|
| YTD return % | `(latest_equity / equity_at_first_trading_day_of_year) − 1` | `portfolio_snapshots` filtered `date >= Jan 1 of current year`, first and latest rows |
| YTD vs. `target_annual_return_pct` | YTD return plotted against a linear pro-rated target line (`target_annual_return_pct × (days_elapsed_in_year / 365)`) | `strategies.performance_goals.target_annual_return_pct` |
| YTD vs. benchmark | same window, `SPY` rebased to the account's starting equity | `price_bars` where `symbol = benchmark_symbol` |
| Realized win rate / avg R-multiple (real trades only) | `decision_outcomes` where `mode = 'real'` and `resolution` is not `still_open` | aggregate query, reused from `/history`'s existing aggregate logic |
| Chart | equity curve vs. pro-rated target line vs. rebased benchmark, single combo chart, YTD window fixed (this block does not use the timeframe selector in Block C — it is always YTD by definition) | |

Per `artisan-v2-spec.md` §5.4: this block is **informational only**. It must never be paired with any UI affordance that could read as "increase risk to catch up" (no "boost allocation" button, no auto-suggested parameter change). If you want that hard rule visibly enforced, add a static footnote: *"Performance context does not change position sizing or eligibility. See Strategy → Risk & Sizing for the parameters that do."*

**Block C — Order-level real-time symbol performance**

Per-position (and optionally watchlist/shortlist) chart with a timeframe selector: **1D · 1W · 1M · 6M · YTD · 1Y · All**.

| Timeframe | Data source | Granularity |
|---|---|---|
| 1W, 1M, 6M, YTD, 1Y, All | `price_bars` (daily OHLCV, already ingested nightly) | daily close, no gap |
| 1D | **not currently available** — `price_bars` is daily-only (§14: Alpaca IEX free tier ingested once nightly). Requires a new read-only intraday quote/bar endpoint, §8.6 | intraday, via live Alpaca data proxy |

Each open position gets a row: symbol, entry date, entry/current price, unrealized P/L, R-multiple-to-date, days held vs. `effective_horizon_days` (progress bar, red past the 30-day hard ceiling), a sparkline (defaults to the selected global timeframe, or override per-row), and a link into Recommendations → that symbol's full history (original thesis, every agent's read, every Position Review verdict since entry).

### 2.2 Positions tab

This is the existing `/positions` page (v2-17) — correct in substance, keep as-is functionally, move under Dashboard per §1.1. One addition: the latest Position Review verdict already renders inline per the current build; add a one-click link from that verdict straight into Briefing → Position Review agent, scrolled to that entry (see §4.4).

### 2.3 Account tab

Existing `/account` page (v2-18) — correct in substance (equity curve, drawdown chart, benchmark rebasing already implemented), move under Dashboard per §1.1, no functional changes required beyond the nav relocation.

### 2.4 Acceptance criteria

1. Block A renders live Alpaca account data with a visibly labeled fallback state when Alpaca credentials are unset (matches existing `/account` "Alpaca credentials are not configured" pattern — do not silently show zeros).
2. Block B's YTD figure and the pro-rated target line are both visible on first load with no interaction required, and the "informational only" footnote is present.
3. Block C's timeframe selector correctly switches the query window for every non-1D option using only already-ingested `price_bars`; 1D is either implemented against a real intraday source or explicitly disabled with a tooltip explaining why ("live intraday data pending broker integration"), never silently showing daily data mislabeled as 1D.
4. No block in this page ever suggests, implies, or exposes a control that would increase risk or position size based on being behind the YTD target.

---

## 3. Recommendations

This is the highest-value page in the whole rebuild — it's where "what should I trade, why, and how" (your framing) actually gets answered. It merges the existing Queue (v2-16) and the shortlist/timing half of Strategy (v2-21), and adds a drill-down layer onto `agent_analyses` that does not exist anywhere in the current build.

**Route:** `/recommendations` · **Tabs:** New Recommendations (default) · Position Actions · Shortlist · Orders

### 3.1 Tab: New Recommendations

List/card view of `recommendations` where `status = 'pending'` for the latest `pipeline_runs` row. Per row:

| Element | Source |
|---|---|
| Symbol, action (enter/watch/skip), conviction (high/medium/low) | `recommendations` |
| Entry / stop / target / shares / dollar risk | `recommendations` (code-computed, carried from `entry_signals` at creation) |
| `effective_horizon_days` with a countdown to `expire_stale` (next pipeline run) | `recommendations`, `pipeline_runs` |
| One-line thesis | `recommendations.thesis` (truncated; full text in detail view) |
| Historical precedent snippet | `recommendations.historical_precedent` (truncated; full detail on click) |

Clicking a row opens the **Recommendation Detail** view (§3.5) rather than navigating away — implement as a slide-over drawer on desktop, full-screen push on mobile, so the list stays in context.

Row-level actions (also available inside the detail view): **Approve** · **Approve with edits** · **Reject**. See §3.6 for the approval contract.

### 3.2 Tab: Position Actions

List of `position_reviews` where `status = 'pending'` and `recommended_action` requires approval (`add`, or any stop-loosening — per `artisan-v2-spec.md` §10.3, `close`/`trim`/`tighten_stop` are risk-reducing and auto-apply, so they should appear here **read-only, already-applied**, not as pending approvals). Same drawer/detail pattern as §3.5, scoped to a position instead of a new entry.

### 3.3 Tab: Shortlist

This is `/strategy`'s existing Block 1 (Strategy Summary / funnel) + Block 2 (Stocks to Trade) + Block 3 (When to Trade) from `specs.md` §9, unchanged in substance:

- Funnel: screened → hard-filtered → scored → in portfolio, with the live regime badge (`regime_snapshots`).
- Ranked factor table: symbol, sector, five factor z-scores + prior-run deltas, composite rank, `NEW` chip — `factor_scores`.
- Timing table: gate pills, setup label, entry/stop/target, R, shares, dollar risk, `actionable` highlight — `entry_signals`.

New requirement not in the current `/strategy` build: **every row in both tables is clickable** and opens the same symbol-scoped detail view described in §3.5 (a symbol that's merely shortlisted, with no recommendation yet, still shows its full factor breakdown, gate-by-gate timing state, and — if any exist — prior `agent_analyses`/`decision_outcomes` for that symbol). This is what answers "disclose symbols proposed and reasoning ... so I can clearly see what we should trade and why" even before a formal recommendation exists.

### 3.4 Tab: Orders

Existing `/orders` page (v2-19) — correct in substance (filters, edited-approval flagging, still-open tracking), move under Recommendations per §1.1, no functional changes required beyond nav relocation. Each row links back to its source `recommendation` via the existing detail view (§3.5).

### 3.5 Recommendation / symbol detail view (new)

This is the core new requirement: *"When I click on a recommendation, I should be able to see all the details of how this recommendation was developed so I can validate the agents' reasoning, the deterministic computations which were done etc."*

Structure, top to bottom:

**1. Executive summary**
- Symbol, action, conviction, `effective_horizon_days`, expiry countdown
- Full thesis (`recommendations.thesis`)
- Invalidation conditions (`recommendations.invalidation_conditions`, rendered as a checklist — each one should be checkable against current data where possible, e.g. a price-level condition shows current price alongside it)
- Redundancy note (`recommendations.redundancy_note`)
- Historical precedent (`recommendations.historical_precedent`) with a link to the full filtered `/history` view for that symbol/setup/regime combination

**2. Deterministic computation trace** — the part that lets you "validate ... the deterministic computations":
- Market regime at time of scoring: `regime_snapshots` row (regime, `spy_vs_sma`, `spy_vol_percentile`, `spy_drawdown_from_high_pct`)
- Factor breakdown: all five `factor_scores` z-scores with the underlying component values where available (e.g. Value's five sub-yields), composite_z, rank, `hard_filter_pass`
- Gate-by-gate timing trace: each of Gate 0–5 from `entry_signals` shown individually (pass/fail + the actual indicator value against its threshold, e.g. "ADX_14 = 24.1, threshold > 20 — pass"), not just the final `actionable` boolean
- Sizing math, shown as substituted arithmetic, not just the output numbers:
  ```
  dollar_risk_per_trade = equity ($X) × risk_per_trade_pct (Y%) = $Z
  shares_by_risk = floor($Z / (entry $A − stop $B)) = N shares
  shares_by_cap  = floor((equity $X × max_position_pct W%) / entry $A) = M shares
  final_shares   = min(N, M) = <final>
  ```
  Pull the live `risk_per_trade_pct` / `max_position_pct` values from `strategies` so this trace is never stale relative to the config that actually produced it — join on `recommendations`' snapshotted values if the config has since changed, and label clearly which is which ("computed under the config active at creation time").

**3. Agent reasoning — one card per analyst, in the order they run**
- **Fundamental Analyst**: `summary`, `key_drivers`, `quality_assessment`, `red_flags`, `trend_vs_prior_run`, `historical_precedent` — from `agent_analyses` where `agent_type = 'fundamental_analyst'`, joined by `run_id` + `symbol`
- **Technical Analyst**: `summary`, `setup_quality`, `confirmation_strength`, `technical_invalidation_note`, `regime_fit`, `historical_precedent` — `agent_analyses` where `agent_type = 'technical_analyst'`
- **Sentiment Analyst**: `summary`, `sentiment_direction`, `materiality`, `catalysts_identified`, `red_flags`, `historical_precedent` — `agent_analyses` where `agent_type = 'sentiment_analyst'`
- Each card shows `prompt_version` and `model` used for that specific call (both already logged per `artisan-v2-spec.md` §2.6) as a small metadata line — this is what makes a later prompt edit (§7) auditable against the recommendations it actually influenced.
- Where the three analysts disagree (e.g. Fundamental flags `quality_assessment: concerning` while Technical shows `setup_quality: strong`), visually surface the disagreement rather than letting it get lost across three separate cards — a small "cross-pillar agreement" indicator at the top of this section, computed client-side from the three outputs, satisfies this.

**4. Synthesis reasoning card** — the Synthesis agent's own output for this symbol (same fields as executive summary, but this is where you'd also show, if `action = 'watch'` or `'skip'`, *why* it wasn't promoted to enter — e.g. redundancy or a downgrade from an analyst red flag).

**5. Order proposal editor** (only present for `action = 'enter'` recommendations and `add`-type position actions):
- Fields: shares (editable), stop_price (editable), target_price (editable). Entry price is a reference value, not editable (market orders only, per `artisan-v2-spec.md` §16.1).
- Every edit re-runs the sizing/risk validation client-side immediately (against the same `strategies` bounds shown in the computation trace) and blocks submission with a specific message if a bound is breached — mirroring, not replacing, the server-side re-validation in `execute-trade`.
- Buttons: **Approve as-is** · **Approve with edits** · **Reject**. All three are logged (§3.6).

**6. Outcome (if resolved)** — once `decision_outcomes` for this recommendation has resolved (`hit_target`/`hit_stop`/`time_expired_*`/`superseded`), show the resolution inline instead of the order editor: what happened, `r_multiple`, `days_to_resolution`, and whether it was `real` or `shadow` mode.

### 3.6 Approval & execution contract

Reuses `artisan-v2-spec.md` §16.1/§17 exactly — this document does not change the backend contract, only specifies the frontend's obligations around it:

1. On **Approve** (as-is or with edits), the frontend calls `execute-trade` with `{trade_intent_id, overrides?: {shares?, stop_price?, target_price?}}` and must not optimistically show "approved"/"filled" before the Edge Function responds.
2. While the call is in flight, the row/detail view shows a distinct **Submitting** state (not the same visual as Pending or Approved).
3. On success, transition to **Filled** (or **Rejected by broker** if the Edge Function's re-validation fails — display the specific rejection reason returned, e.g. "edited stop breaches max_position_pct") — never a generic "Something went wrong."
4. On **Reject**, no broker call is made; the row moves to a Rejected state and `decision_outcomes` continues tracking it in `shadow` mode — the frontend should say this explicitly ("Still tracked — see History") so it's clear rejecting isn't the same as deleting.
5. Subscribe to `trade_executions` and `portfolio_positions` via Supabase Realtime so a fill that completes seconds later updates the UI without a manual refresh.
6. Any recommendation or position action left unreviewed through the next `daily_pipeline` run transitions to `expired` (per §12.4) — the frontend must reflect this on next load without the user needing to know that happened server-side; an expired item is visually distinct from rejected (rejected = you decided; expired = you didn't get to it) and both link into History.

### 3.7 Acceptance criteria

1. Every `recommendations` row rendered anywhere in this section links to a detail view containing all five numbered blocks in §3.5 where data exists, and an honest "not yet available" state where it doesn't (e.g. a `watch`-only symbol has no order editor — that's correct, not a bug).
2. The sizing math in Block 2 reproduces, with real numbers substituted, the exact formula in `artisan-v2-spec.md` §11.1 — a developer or the user should be able to hand-check it with a calculator.
3. Approve/Reject actions never show a success state before the corresponding backend call actually resolves.
4. A symbol with zero recommendations but a `factor_scores`/`entry_signals` row (i.e. shortlisted, not yet actionable) still opens a detail view showing what exists — the shortlist tab's "click any row" requirement from §3.3.

---

## 4. Briefing

*"Show the outcomes of all my agents' synthesis and how it all comes together into final briefing... broken down by agents so I can see a separate log of each agent involved... organised from most recent to the oldest."*

**Route:** `/briefing` · **Tabs:** Daily Digest (default) · Fundamental Analyst · Technical Analyst · Sentiment Analyst · Synthesis · Position Review

(Six agents total per the roster in `artisan-v2-spec.md` §2.2; the Daily Briefing agent's own output *is* the Daily Digest tab, so it isn't a 7th tab.)

### 4.1 Tab: Daily Digest

This is the existing `/briefings` page (v2-23) — correct in substance (urgent flags, regime line, new-recommendations summary, position-actions summary, outcomes note, portfolio-state line, full markdown digest). Keep as the landing tab. One addition: every symbol mentioned in the digest text should deep-link to that symbol's entry in the relevant per-agent tab below (e.g. clicking a symbol named in "new recommendations" jumps to the Synthesis tab, scrolled to that run's entry for that symbol).

### 4.2 Per-agent tabs — shared structure

Each of the 5 remaining tabs (Fundamental / Technical / Sentiment / Synthesis / Position Review) is a **reverse-chronological log**, most recent run first, of that agent's output. This is genuinely new — nothing in the current build exposes `agent_analyses` at all.

Data source per tab:

| Tab | Source table | Filter |
|---|---|---|
| Fundamental Analyst | `agent_analyses` | `agent_type = 'fundamental_analyst'` |
| Technical Analyst | `agent_analyses` | `agent_type = 'technical_analyst'` |
| Sentiment Analyst | `agent_analyses` | `agent_type = 'sentiment_analyst'` |
| Synthesis | `recommendations` | one entry per symbol per run (Synthesis writes directly to `recommendations`, not `agent_analyses` — see `artisan-v2-spec.md` §2.2 table) |
| Position Review | `position_reviews` | one entry per open position per run |

Each log entry, regardless of tab, renders as a card with:
- Run date, symbol, `prompt_version`, `model`
- The agent's full structured output (every field from its `submit_*` schema in `artisan-v2-agent-prompts.md` — see §4.3 below for the exact field list per agent)
- `historical_precedent` always visible, never collapsed — per the agent-prompts document, this field exists specifically so you can verify the agent actually consulted decision history rather than reasoning from scratch each time; hiding it defeats the purpose
- A link to the downstream artifact this feed into (the `recommendation` or `position_review` it informed, if not already on that tab)

Pagination/virtualization: default to the last 30 days per symbol-filtered view, last 7 days unfiltered (this will be a lot of rows once 30 symbols × 3 analysts × 1 run/day accumulates — don't load the whole table by default).

Filters available on every per-agent tab: date range, symbol, and (for Synthesis/Position Review) action/verdict.

### 4.3 Field reference per agent (for implementation — matches `artisan-v2-agent-prompts.md` exactly)

| Agent | Fields to render |
|---|---|
| Fundamental Analyst | `summary`, `key_drivers[]`, `quality_assessment`, `red_flags[]`, `trend_vs_prior_run`, `historical_precedent` |
| Technical Analyst | `summary`, `setup_quality`, `confirmation_strength`, `technical_invalidation_note`, `regime_fit`, `historical_precedent` |
| Sentiment Analyst | `summary`, `sentiment_direction`, `materiality`, `catalysts_identified[]`, `red_flags[]`, `historical_precedent` |
| Synthesis | `action`, `conviction`, `thesis`, `invalidation_conditions[]`, `redundancy_note`, `historical_precedent` |
| Position Review | `recommended_action`, `reasoning`, `suggested_new_stop`, `suggested_new_target`, `historical_precedent` |

Any future prompt edit (§7) that changes an agent's output schema must be reflected here — treat this table as the frontend's contract with `artisan-v2-agent-prompts.md`, and version it alongside prompt changes.

### 4.4 Cross-links

- From Dashboard → Positions, each position's latest Position Review verdict links here, scrolled to that entry.
- From Recommendations → detail view, each analyst card links here, scrolled to that entry (same data, different context — the detail view shows it inline for one symbol; this page shows the full log across symbols and time).

### 4.5 Acceptance criteria

1. All 5 per-agent tabs render real `agent_analyses`/`recommendations`/`position_reviews` data, most-recent-first, with no page anywhere silently limiting to "today only" without a visible date-range control.
2. `historical_precedent` is visible by default on every card, every tab — not behind a second click.
3. Every field listed in §4.3 for a given agent is rendered somewhere in that agent's card — no schema field silently dropped.

---

## 5. Strategy

*"Capture all the parameters ... editable ... In this section I should also have a section with agents, where I can edit models ... and their prompts."*

**Route:** `/strategy` · **Tabs:** Config (default) · Agents

### 5.1 Tab: Config

This merges the existing `/settings` page (v2-22 — already implements 21 editable parameters across 6 groups with an 11-field nested-control expansion and an audit trail) with the factor-methodology disclosure currently missing from both `/settings` and `/strategy`. Functionally, `/settings`' existing editor is correct and should not be rebuilt — relocate it here per §1.1 and extend it as follows.

Master parameter table (identical to `artisan-v2-spec.md` §13 — reproduced here so this document is a complete implementation reference on its own):

| Group | Parameter | Default | Bound |
|---|---|---|---|
| Risk & sizing | `risk_per_trade_pct` | 1% | 0.1%–5% |
| | `max_position_pct` | 10% | 2%–25% |
| | `max_concurrent_positions` | 15 | 3–30 |
| | `max_sector_exposure_pct` | 25% | — |
| | `max_portfolio_heat_pct` | 8% | — |
| | `daily_drawdown_kill_switch_pct` | −3% | — |
| | `max_drawdown_tolerance_pct` | 18% | — |
| Screening & shortlisting | `shortlist_size` | 30 | — |
| | `daily_recommendation_cap` | 8–10 | — |
| | `factor_weights` (Value/Quality/Momentum/LowVol/Growth) | 25/25/25/10/15 | marked "advanced" |
| Timing & horizon | `max_holding_period_days` | 30 | — |
| | `horizon_baseline_days` (per setup type) | pullback 20 / breakout 15 / squeeze 10 | — |
| | `regime_multipliers` | risk_on 1.0 / neutral 0.85 / risk_off 0.65 | — |
| | `earnings_blackout_pre_days` / `_post_days` | 3 / 1 | — |
| Position management | `trailing_stop_atr_multiple` | 2 | — |
| | `breakeven_trigger_r` | 1 | — |
| | `auto_apply_stop_tightening` | true | — |
| Performance goals | `target_annual_return_pct` | 25% | — |
| | `benchmark_symbol` | SPY | — |
| Cost control | `llm_daily_cost_cap_usd` | — | — |

New requirement not in the current `/settings` build: **every parameter group renders its governing formula/rule as inline help text**, sourced from `artisan-v2-spec.md` §5–§11, so the page is self-documenting rather than a bare list of numbers with no context. Examples:
- Next to `risk_per_trade_pct`/`max_position_pct`: show the live sizing formula from §11.1 with the *current* values substituted (same pattern as the Recommendation detail view's computation trace, §3.5).
- Next to `regime_multipliers`: show the current regime (from the latest `regime_snapshots` row) and which multiplier is active right now.
- Next to `factor_weights`: show the five factor formulas from §6/`specs.md` §9.4 in a collapsible "methodology" panel, not just weight sliders.

Every edit continues to write an `audit_log` row exactly as `/settings` already does (old value, new value, who, when) — no change to that mechanism, just relocate the UI.

### 5.2 Tab: Agents (new)

Six agent cards — Fundamental Analyst, Technical Analyst, Sentiment Analyst, Synthesis, Position Review, Daily Briefing — each with:

| Field | Editable | Notes |
|---|---|---|
| Model | yes, dropdown | constrained to an allow-list (`claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5`) — free text is not acceptable here, a typo'd model string breaks a real trading day |
| System prompt | yes, large monospace text area | pre-populated from the agent's current version; edits are staged, not live, until Save |
| Current `prompt_version` | display-only | |
| Last modified (who, when) | display-only | |
| Version history | yes — list of prior versions with diff view and one-click **Restore this version** | |

Save flow:
1. On Save, diff the new prompt/model against the currently active version and show the diff in a confirmation modal before committing — this is exactly the kind of change `artisan-v2-spec.md`'s philosophy treats as "a reviewable diff, not a silent behavior change" (§2.6), and a bad prompt edit silently degrading live paper-trading decisions is a real operational risk worth one extra click.
2. On confirm, write a new `agent_configs` row (§7.1 — new table, this document's one backend addition), increment `prompt_version`, write an `audit_log` entry, and mark the new row `is_active = true` (previous row `is_active = false`, retained for history/rollback).
3. Takes effect on the next pipeline run — same "no mid-flight inconsistency" guarantee `artisan-v2-spec.md` §13 already establishes for strategy config, since every run's recommendations regenerate fresh.

Stretch (Phase 2, not required for initial ship): a "Test this prompt" action that runs the edited prompt against one real symbol's current data in a dry-run (no DB writes, no effect on the live queue) and shows the output before you decide to save — valuable given `artisan-v2-agent-prompts.md`'s own closing note that these are first drafts expected to need iteration against real output.

### 5.3 Acceptance criteria

1. All 21+ parameters from the §5.1 table are editable from this page, each with a visible bound and a rejection message if the bound is violated (already true of `/settings` — must not regress on relocation).
2. Every factor/sizing/timing formula referenced by a parameter group is shown inline with current values substituted, not just as a bare number input.
3. All 6 agents in the Agents tab have an editable model dropdown (allow-listed) and an editable prompt text area, a working Save→diff→confirm flow, and a version history with restore.
4. A saved prompt/model change is provably picked up by the next pipeline run — i.e. the next run's `agent_analyses`/`recommendations`/`position_reviews` rows log the new `prompt_version`, not the old one.

---

## 6. Cross-cutting component requirements

- **Empty/loading/error states:** replace bare `0` / `—` / "No X yet" text (current pattern on nearly every page, acceptable only because there's no data yet) with skeleton loaders for the loading state, and keep an explicit, worded empty state for genuinely-empty data — do not let a loading state and a genuinely-empty state look identical.
- **Realtime:** `recommendations`, `position_reviews`, `trade_executions`, and `portfolio_positions` should all be Supabase Realtime-subscribed wherever they're rendered, so approvals and fills reflect without manual refresh (§3.6).
- **Tables at scale:** the Shortlist tab (30 rows daily, growing) and History (unbounded, growing daily) need sorting, pagination or virtualization, and column-level filtering — the current build's tables are fine at zero rows but untested at real volume.
- **Consistent symbol drill-down:** a symbol name/ticker anywhere in the product (Dashboard position row, Recommendations list, Briefing log entry, History row) should be a consistent, single click-target pattern that opens the same detail view (§3.5) or a scoped variant of it — don't let four different pages invent four different "click a symbol" behaviors.
- **Visual design system:** unchanged. The dark theme, card layout, and typography in the current build are not the problem and should be preserved as-is through this rebuild — this document is an IA and completeness fix, not a redesign.

---

## 7. New backend surface: agent configuration (required for §5.2)

Everything else in this document reads from tables `artisan-v2-spec.md` already defines. Editable agent model/prompt is the one exception — the v2 spec keeps prompts as versioned files (`engine/artisan/agents/prompts/*.md`, §2.6), loaded at runtime by path, which is not editable from a browser. This section is the minimal addition needed to make §5.2 real rather than decorative.

### 7.1 New table: `agent_configs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `agent_type` | enum | `fundamental_analyst`, `technical_analyst`, `sentiment_analyst`, `synthesis`, `position_review`, `briefing` |
| `model_id` | text | allow-listed at the application layer, not DB-enforced |
| `prompt_text` | text | full system prompt, same structure as `artisan-v2-agent-prompts.md` |
| `prompt_version` | text | incremented on every save |
| `is_active` | boolean | exactly one active row per `agent_type` |
| `created_at`, `updated_at` | timestamptz | |
| `updated_by` | text | |

### 7.2 Migration

Seed six rows from the current contents of `artisan-v2-agent-prompts.md` / `engine/artisan/agents/prompts/*.md` at rollout, `prompt_version = 'v1'`, so there is zero behavior change on ship day.

### 7.3 Engine change (outside frontend scope, listed as a dependency)

The orchestration layer must load `model_id` and `prompt_text` from `agent_configs` where `is_active = true` at the start of each pipeline run, instead of (or as a fallback-ordered alternative to) the static file path. Without this change, §5.2's save button edits a value nothing reads — flagging this explicitly because it's the one requirement in this document with a hard backend dependency outside the Next.js app.

---

## 8. Backend/API gap list (summary, all sections)

| # | Gap | Needed for | Effort |
|---|---|---|---|
| 1 | `Navbar.tsx` route list + IA restructure | §1 | frontend-only |
| 2 | YTD equity-vs-target-vs-benchmark query (portfolio_snapshots from Jan 1 + rebased SPY) | §2.1 Block B | small, frontend query |
| 3 | Server-side intraday quote/bar proxy (new API route, Alpaca key stays server-side per `CLAUDE.md`'s "never call broker directly from frontend" rule) | §2.1 Block C, 1D view | medium |
| 4 | Read view/query joining `recommendations` + 3× `agent_analyses` + `factor_scores` + `entry_signals` + `regime_snapshots` + `decision_outcomes` by `run_id`/`symbol` | §3.5 detail view | medium — a Postgres view simplifies this considerably |
| 5 | Paginated `agent_analyses` read API filtered by `agent_type`, date range, symbol | §4.2 per-agent log | small |
| 6 | Supabase Realtime subscriptions wired into the frontend for `recommendations`, `position_reviews`, `trade_executions`, `portfolio_positions` | §3.6, §6 | small, frontend-only |
| 7 | `agent_configs` table + seed migration | §5.2, §7.1–7.2 | small |
| 8 | Engine reads `model_id`/`prompt_text` from `agent_configs` instead of static files | §5.2, §7.3 | medium, engine-side |

Items 1, 2, 6 have no backend dependency and can ship first. Items 4, 5, 7 are additive schema/API work with no risk to the existing pipeline. Item 8 is the one change that touches the live trading engine and should be tested against the eval-set approach `artisan-v2-agent-prompts.md`'s own "Testing & iteration" section already recommends before it's trusted with a real prompt edit. Item 3 is the only genuinely new external-data dependency (intraday quotes) and can be deferred to a later phase without blocking anything else in this document.

---

## 9. Suggested build order

1. IA/nav rebuild (§1) — unblocks everything else, zero backend dependency, fixes the most visible complaint immediately.
2. Recommendation detail view (§3.5) using data that already exists (`recommendations`, `factor_scores`, `entry_signals`, `agent_analyses` are all already populated by the v2 engine — this is a pure read/UI gap, item #4 in §8 the only new plumbing).
3. Briefing per-agent tabs (§4) — same story, reads data that already exists.
4. Dashboard YTD block + Positions/Account relocation (§2) — small new query, no new tables.
5. Strategy Config relocation + inline formula disclosure (§5.1) — mostly UI work on an already-correct backend.
6. `agent_configs` table + Agents tab (§5.2, §7) — the one item with real engine-side risk; build behind the eval-set testing discipline already specified in `artisan-v2-agent-prompts.md`.
7. Intraday quotes (§2.1 Block C, 1D view) — lowest priority, genuinely new data source, no other requirement depends on it.

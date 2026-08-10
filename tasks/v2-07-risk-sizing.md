# v2-07 — Risk & Sizing Module

**Depends on:** v2-01, v2-02
**Touches:** `engine-py/artisan/risk/sizing.py` (new), `engine-py/artisan/risk/trailing_stop.py` (new) — `engine-py/artisan/risk/` does not exist today, confirmed no collision

## Context

Position sizing, portfolio-level risk vetoes, and the automatic trailing-stop ratchet are currently scattered inline inside `timing/entry_gates.py`. The v2 spec formalizes these as their own module (§11.1–11.3) because they're consumed from multiple places: the Synthesis agent needs sizing + veto checks before recommending an ENTER, the Position Review agent needs the trailing-stop ratchet applied automatically (no approval required — it's risk-reducing), and the `execute-trade` edge function needs to re-validate sizing when a user edits shares/stop/target before approving.

## Scope

### `engine-py/artisan/risk/sizing.py`

```python
def compute_position_size(equity: float, entry_price: float, stop_price: float, strategy_params: StrategyParams) -> dict:
    dollar_risk = equity * strategy_params.risk_per_trade_pct
    shares_by_risk = floor(dollar_risk / (entry_price - stop_price))
    shares_by_cap = floor((equity * strategy_params.max_position_pct) / entry_price)
    shares = min(shares_by_risk, shares_by_cap)
    return {"shares": shares, "dollar_risk": round(shares * (entry_price - stop_price), 2)}

def check_portfolio_vetos(candidate: dict, portfolio_state: dict, strategy_params: StrategyParams) -> list[str]:
    """
    Returns triggered veto names; empty list = eligible. Checks (spec §9.3):
      - risk_budget_exhausted: sum of open positions' dollar_risk + candidate's dollar_risk
        would exceed equity * max_portfolio_heat_pct
      - sector_cap_breach: candidate's sector exposure (existing + candidate) would exceed
        equity * max_sector_exposure_pct
      - correlation_breach: candidate is highly correlated (>0.7, trailing 60d returns) with
        an existing open position in the same sector
      - max_concurrent_positions: open position count already at strategy_params.max_concurrent_positions
      - drawdown_tolerance_breach: current drawdown_from_high_pct (from latest portfolio_snapshots)
        already at or past max_drawdown_tolerance_pct — no new entries allowed at all
    """
```

### `engine-py/artisan/risk/trailing_stop.py`

```python
def apply_trailing_stop_ratchet(position: dict, current_price: float, strategy_params: StrategyParams) -> dict | None:
    """
    Auto-applies with no approval needed (spec §10.2 — risk-reducing actions bypass the queue):
      - breakeven trigger: once unrealized P/L >= breakeven_trigger_r * R (default 1R), move stop to entry_price
      - trailing: stop = max(current stop, current_price - trailing_stop_atr_multiple * ATR_14),
        i.e. it only ever ratchets up (or to breakeven), never down
    Returns {"new_stop_price": float} if the stop should move, else None (no-op).
    """
```

Called from `review_positions.py` (v2-14) **before** the Position Review agent runs for each open position — the agent sees the already-ratcheted stop, not the stale one. Applying it is a direct `UPDATE portfolio_positions SET stop_price = ...` — it's a risk-reducing mechanical action, not something that goes through `position_reviews`/the approval queue.

## Verification
1. `engine-py/tests/test_sizing.py` (new): unit tests for `compute_position_size()` (verify the risk-based vs cap-based share count picks the smaller one in both directions) and for each of the 5 veto conditions in `check_portfolio_vetos()` individually and in combination.
2. `engine-py/tests/test_trailing_stop.py` (new): unit tests — stop below breakeven trigger does nothing; crossing breakeven moves stop to entry; price continuing up ratchets the ATR-based trail; price dropping does *not* move the stop backward down.
3. Sanity check against a hand-computed example: $100k equity, 1% risk, $50 entry, $48 stop → `dollar_risk = $1,000`, `shares_by_risk = floor(1000/2) = 500`; with `max_position_pct=0.10` → `shares_by_cap = floor(10000/50) = 200`; final `shares = 200`.

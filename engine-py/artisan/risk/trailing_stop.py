from __future__ import annotations

from typing import Any

from artisan.strategy_params import StrategyParams


def apply_trailing_stop_ratchet(
    position: dict[str, Any], current_price: float, strategy_params: StrategyParams
) -> dict[str, Any] | None:
    """Spec §10.2/§11.3: a risk-reducing, auto-applied action — no approval needed.

    position: {entry_price, current_stop_price, r_dollars (per-share risk at entry,
      i.e. entry_price - initial_stop_price — defines "1R"), atr_14}

    Ratchets the stop up only, never down:
      - breakeven trigger: once unrealized P/L per share >= breakeven_trigger_r * R,
        the stop moves to (at least) entry_price.
      - ATR trail: stop tracks max(current stop, current_price - trailing_stop_atr_multiple * ATR_14).

    Returns {"new_stop_price": float} if the stop should move, else None.
    """
    entry_price = position["entry_price"]
    current_stop = position["current_stop_price"]
    r_dollars = position.get("r_dollars")
    atr_14 = position.get("atr_14")

    candidate_stop = current_stop

    if r_dollars is not None and r_dollars > 0:
        unrealized_per_share = current_price - entry_price
        breakeven_trigger = strategy_params.breakeven_trigger_r * r_dollars
        if unrealized_per_share >= breakeven_trigger:
            candidate_stop = max(candidate_stop, entry_price)

    if atr_14 is not None:
        trail_stop = current_price - strategy_params.trailing_stop_atr_multiple * atr_14
        candidate_stop = max(candidate_stop, trail_stop)

    if candidate_stop > current_stop:
        return {"new_stop_price": round(candidate_stop, 4)}
    return None

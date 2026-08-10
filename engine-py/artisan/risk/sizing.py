from __future__ import annotations

import math
from typing import Any

import pandas as pd

from artisan.strategy_params import StrategyParams

CORRELATION_BREACH_THRESHOLD = 0.7
CORRELATION_MIN_OBSERVATIONS = 10


def compute_position_size(
    equity: float, entry_price: float, stop_price: float, strategy_params: StrategyParams
) -> dict[str, Any]:
    """Spec §11.1: shares = min(risk-based size, max-position-pct cap)."""
    if entry_price <= 0 or entry_price <= stop_price:
        return {"shares": 0, "dollar_risk": 0.0}

    stop_distance = entry_price - stop_price
    dollar_risk_budget = equity * strategy_params.risk_per_trade_pct
    shares_by_risk = math.floor(dollar_risk_budget / stop_distance)
    shares_by_cap = math.floor((equity * strategy_params.max_position_pct) / entry_price)
    shares = max(0, min(shares_by_risk, shares_by_cap))

    return {"shares": shares, "dollar_risk": round(shares * stop_distance, 2)}


def check_portfolio_vetos(
    candidate: dict[str, Any], portfolio_state: dict[str, Any], strategy_params: StrategyParams
) -> list[str]:
    """Spec §9.3/§11.2: returns the names of every triggered veto; empty = eligible.

    candidate: {symbol, sector, dollar_risk, dollar_value, returns_60d (optional, for
      the correlation check)}
    portfolio_state: {equity, drawdown_from_high_pct, open_positions: [{symbol,
      sector, dollar_risk, dollar_value, returns_60d}, ...]}
    """
    triggered: list[str] = []
    equity = portfolio_state.get("equity") or 0.0
    open_positions: list[dict[str, Any]] = portfolio_state.get("open_positions") or []

    drawdown = portfolio_state.get("drawdown_from_high_pct")
    if drawdown is not None and abs(drawdown) >= strategy_params.max_drawdown_tolerance_pct:
        triggered.append("drawdown_tolerance_breach")

    if len(open_positions) >= strategy_params.max_concurrent_positions:
        triggered.append("max_concurrent_positions")

    if equity > 0:
        existing_risk = sum(float(p.get("dollar_risk") or 0.0) for p in open_positions)
        candidate_risk = float(candidate.get("dollar_risk") or 0.0)
        if (existing_risk + candidate_risk) > equity * strategy_params.max_portfolio_heat_pct:
            triggered.append("risk_budget_exhausted")

    candidate_sector = candidate.get("sector")
    if equity > 0 and candidate_sector:
        existing_sector_value = sum(
            float(p.get("dollar_value") or 0.0)
            for p in open_positions
            if p.get("sector") == candidate_sector
        )
        candidate_value = float(candidate.get("dollar_value") or 0.0)
        if (existing_sector_value + candidate_value) > equity * strategy_params.max_sector_exposure_pct:
            triggered.append("sector_cap_breach")

    if candidate_sector and _correlated_with_peer_in_sector(candidate, open_positions, candidate_sector):
        triggered.append("correlation_breach")

    return triggered


def _correlated_with_peer_in_sector(
    candidate: dict[str, Any], open_positions: list[dict[str, Any]], sector: str
) -> bool:
    candidate_returns = candidate.get("returns_60d")
    if candidate_returns is None:
        return False
    candidate_series = pd.Series(candidate_returns).reset_index(drop=True)

    for position in open_positions:
        if position.get("sector") != sector:
            continue
        peer_returns = position.get("returns_60d")
        if peer_returns is None:
            continue
        peer_series = pd.Series(peer_returns).reset_index(drop=True)
        aligned = pd.concat([candidate_series, peer_series], axis=1).dropna()
        if len(aligned) < CORRELATION_MIN_OBSERVATIONS:
            continue
        correlation = aligned.iloc[:, 0].corr(aligned.iloc[:, 1])
        if correlation is not None and correlation > CORRELATION_BREACH_THRESHOLD:
            return True

    return False

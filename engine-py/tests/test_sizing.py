from __future__ import annotations

import numpy as np

from artisan.risk.sizing import check_portfolio_vetos, compute_position_size


def test_compute_position_size_hand_computed_example(strategy_params) -> None:
    # $100k equity, 1% risk, $50 entry, $48 stop -> dollar_risk=$1,000,
    # shares_by_risk=floor(1000/2)=500; max_position_pct=0.10 -> shares_by_cap=floor(10000/50)=200
    result = compute_position_size(100_000, 50.0, 48.0, strategy_params)
    assert result == {"shares": 200, "dollar_risk": 400.0}


def test_compute_position_size_picks_risk_based_when_smaller(strategy_params) -> None:
    # Wide stop -> risk-based size is the binding (smaller) constraint, not the cap
    result = compute_position_size(100_000, 50.0, 40.0, strategy_params)
    # dollar_risk_budget=1000, stop_distance=10 -> shares_by_risk=floor(1000/10)=100
    # max_position_pct cap -> shares_by_cap=floor(10000/50)=200
    assert result["shares"] == 100


def test_compute_position_size_picks_cap_based_when_smaller(strategy_params) -> None:
    # Tight stop -> risk-based size would be huge; cap wins
    result = compute_position_size(100_000, 50.0, 49.9, strategy_params)
    # dollar_risk_budget=1000, stop_distance=0.1 -> shares_by_risk=10000
    # cap -> shares_by_cap=200
    assert result["shares"] == 200


def test_compute_position_size_zero_when_stop_above_entry(strategy_params) -> None:
    assert compute_position_size(100_000, 50.0, 51.0, strategy_params) == {"shares": 0, "dollar_risk": 0.0}


def test_compute_position_size_zero_when_entry_non_positive(strategy_params) -> None:
    assert compute_position_size(100_000, 0.0, -1.0, strategy_params) == {"shares": 0, "dollar_risk": 0.0}


def _base_portfolio_state(**overrides) -> dict:
    state = {"equity": 100_000.0, "drawdown_from_high_pct": -0.02, "open_positions": []}
    state.update(overrides)
    return state


def _base_candidate(**overrides) -> dict:
    candidate = {"symbol": "NEW", "sector": "Tech", "dollar_risk": 500.0, "dollar_value": 5_000.0}
    candidate.update(overrides)
    return candidate


def test_check_portfolio_vetos_none_triggered_when_healthy(strategy_params) -> None:
    vetoes = check_portfolio_vetos(_base_candidate(), _base_portfolio_state(), strategy_params)
    assert vetoes == []


def test_check_portfolio_vetos_drawdown_tolerance_breach(strategy_params) -> None:
    state = _base_portfolio_state(drawdown_from_high_pct=-0.20)  # tolerance is 0.18
    vetoes = check_portfolio_vetos(_base_candidate(), state, strategy_params)
    assert "drawdown_tolerance_breach" in vetoes


def test_check_portfolio_vetos_drawdown_exactly_at_tolerance_trips(strategy_params) -> None:
    state = _base_portfolio_state(drawdown_from_high_pct=-0.18)
    vetoes = check_portfolio_vetos(_base_candidate(), state, strategy_params)
    assert "drawdown_tolerance_breach" in vetoes


def test_check_portfolio_vetos_max_concurrent_positions(strategy_params) -> None:
    open_positions = [{"symbol": f"S{i}", "sector": "Tech", "dollar_risk": 10.0, "dollar_value": 100.0} for i in range(15)]
    state = _base_portfolio_state(open_positions=open_positions)
    vetoes = check_portfolio_vetos(_base_candidate(), state, strategy_params)
    assert "max_concurrent_positions" in vetoes


def test_check_portfolio_vetos_risk_budget_exhausted(strategy_params) -> None:
    # max_portfolio_heat_pct=0.08 -> budget=$8,000; existing risk already near the cap
    open_positions = [{"symbol": "OLD", "sector": "Healthcare", "dollar_risk": 7_800.0, "dollar_value": 1_000.0}]
    state = _base_portfolio_state(open_positions=open_positions)
    vetoes = check_portfolio_vetos(_base_candidate(dollar_risk=500.0), state, strategy_params)
    assert "risk_budget_exhausted" in vetoes


def test_check_portfolio_vetos_sector_cap_breach(strategy_params) -> None:
    # max_sector_exposure_pct=0.25 -> cap=$25,000; existing Tech exposure already near it
    open_positions = [{"symbol": "OLD", "sector": "Tech", "dollar_risk": 100.0, "dollar_value": 23_000.0}]
    state = _base_portfolio_state(open_positions=open_positions)
    vetoes = check_portfolio_vetos(_base_candidate(sector="Tech", dollar_value=5_000.0), state, strategy_params)
    assert "sector_cap_breach" in vetoes


def test_check_portfolio_vetos_sector_cap_not_breached_for_other_sector(strategy_params) -> None:
    open_positions = [{"symbol": "OLD", "sector": "Energy", "dollar_risk": 100.0, "dollar_value": 23_000.0}]
    state = _base_portfolio_state(open_positions=open_positions)
    vetoes = check_portfolio_vetos(_base_candidate(sector="Tech", dollar_value=5_000.0), state, strategy_params)
    assert "sector_cap_breach" not in vetoes


def test_check_portfolio_vetos_correlation_breach(strategy_params) -> None:
    rng = np.random.default_rng(5)
    base_returns = rng.normal(0, 0.01, 90)
    correlated_returns = base_returns + rng.normal(0, 0.0005, 90)  # near-identical -> high correlation

    open_positions = [
        {
            "symbol": "PEER",
            "sector": "Tech",
            "dollar_risk": 100.0,
            "dollar_value": 1_000.0,
            "returns_60d": base_returns.tolist(),
        }
    ]
    state = _base_portfolio_state(open_positions=open_positions)
    candidate = _base_candidate(sector="Tech", returns_60d=correlated_returns.tolist())

    vetoes = check_portfolio_vetos(candidate, state, strategy_params)
    assert "correlation_breach" in vetoes


def test_check_portfolio_vetos_correlation_not_breached_across_sectors(strategy_params) -> None:
    rng = np.random.default_rng(5)
    base_returns = rng.normal(0, 0.01, 90)
    correlated_returns = base_returns + rng.normal(0, 0.0005, 90)

    open_positions = [
        {
            "symbol": "PEER",
            "sector": "Energy",  # different sector -> correlation check doesn't apply
            "dollar_risk": 100.0,
            "dollar_value": 1_000.0,
            "returns_60d": base_returns.tolist(),
        }
    ]
    state = _base_portfolio_state(open_positions=open_positions)
    candidate = _base_candidate(sector="Tech", returns_60d=correlated_returns.tolist())

    vetoes = check_portfolio_vetos(candidate, state, strategy_params)
    assert "correlation_breach" not in vetoes


def test_check_portfolio_vetos_correlation_not_breached_for_uncorrelated_returns(strategy_params) -> None:
    rng = np.random.default_rng(5)
    base_returns = rng.normal(0, 0.01, 90)
    uncorrelated_returns = rng.normal(0, 0.01, 90)

    open_positions = [
        {"symbol": "PEER", "sector": "Tech", "dollar_risk": 100.0, "dollar_value": 1_000.0, "returns_60d": base_returns.tolist()}
    ]
    state = _base_portfolio_state(open_positions=open_positions)
    candidate = _base_candidate(sector="Tech", returns_60d=uncorrelated_returns.tolist())

    vetoes = check_portfolio_vetos(candidate, state, strategy_params)
    assert "correlation_breach" not in vetoes


def test_check_portfolio_vetos_multiple_triggered_in_combination(strategy_params) -> None:
    open_positions = [
        {"symbol": f"S{i}", "sector": "Tech", "dollar_risk": 500.0, "dollar_value": 2_000.0} for i in range(15)
    ]
    state = _base_portfolio_state(open_positions=open_positions, drawdown_from_high_pct=-0.19)
    candidate = _base_candidate(sector="Tech", dollar_risk=1_000.0, dollar_value=5_000.0)

    vetoes = check_portfolio_vetos(candidate, state, strategy_params)
    assert "drawdown_tolerance_breach" in vetoes
    assert "max_concurrent_positions" in vetoes
    assert "risk_budget_exhausted" in vetoes
    assert "sector_cap_breach" in vetoes

from __future__ import annotations

from artisan.risk.trailing_stop import apply_trailing_stop_ratchet


def _position(**overrides) -> dict:
    position = {"entry_price": 100.0, "current_stop_price": 92.0, "r_dollars": 8.0, "atr_14": 2.0}
    position.update(overrides)
    return position


def test_no_movement_below_breakeven_trigger_and_below_atr_trail(strategy_params) -> None:
    # unrealized = 95-100 = -5, below breakeven_trigger_r(1) * r_dollars(8) = 8 -> no breakeven move
    # atr trail = 95 - 2*2 = 91, below current stop of 92 -> no ratchet either
    result = apply_trailing_stop_ratchet(_position(current_stop_price=92.0), current_price=95.0, strategy_params=strategy_params)
    assert result is None


def test_crossing_breakeven_moves_stop_to_entry(strategy_params) -> None:
    # unrealized = 108-100 = 8 == breakeven_trigger_r(1) * r_dollars(8) -> stop moves to entry_price.
    # Wide ATR (10) keeps the trail (108 - 2*10 = 88) below entry_price so breakeven is the binding move.
    result = apply_trailing_stop_ratchet(
        _position(current_stop_price=92.0, atr_14=10.0), current_price=108.0, strategy_params=strategy_params
    )
    assert result == {"new_stop_price": 100.0}


def test_price_continuing_up_ratchets_atr_trail_past_breakeven(strategy_params) -> None:
    # current_price=130 -> atr trail = 130 - 2*2 = 126, above entry_price(100) -> trail wins
    result = apply_trailing_stop_ratchet(_position(current_stop_price=100.0), current_price=130.0, strategy_params=strategy_params)
    assert result == {"new_stop_price": 126.0}


def test_price_dropping_does_not_move_stop_backward(strategy_params) -> None:
    # stop already ratcheted up to 126; price then drops to 110
    # breakeven check: unrealized=10, trigger=8 -> still qualifies but only proposes entry_price=100 < 126
    # atr trail = 110 - 4 = 106 < 126
    result = apply_trailing_stop_ratchet(_position(current_stop_price=126.0), current_price=110.0, strategy_params=strategy_params)
    assert result is None


def test_ratchet_never_returns_a_lower_stop_than_current(strategy_params) -> None:
    for current_price in (80.0, 95.0, 99.0, 100.0):
        result = apply_trailing_stop_ratchet(
            _position(current_stop_price=92.0), current_price=current_price, strategy_params=strategy_params
        )
        if result is not None:
            assert result["new_stop_price"] > 92.0


def test_no_r_dollars_still_applies_atr_trail(strategy_params) -> None:
    result = apply_trailing_stop_ratchet(
        _position(current_stop_price=92.0, r_dollars=None), current_price=130.0, strategy_params=strategy_params
    )
    assert result == {"new_stop_price": 126.0}


def test_no_atr_still_applies_breakeven(strategy_params) -> None:
    result = apply_trailing_stop_ratchet(
        _position(current_stop_price=92.0, atr_14=None), current_price=110.0, strategy_params=strategy_params
    )
    assert result == {"new_stop_price": 100.0}

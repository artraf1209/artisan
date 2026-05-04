from __future__ import annotations

from typing import Any


def passes_hard_filters(fundamentals: dict[str, Any]) -> tuple[bool, str]:
    """
    Non-negotiable pre-scoring gates.
    Returns (passes, reason) where reason is empty string on pass.
    """
    fcf = fundamentals.get("fcf")
    ebitda = fundamentals.get("ebitda")
    total_debt = fundamentals.get("total_debt") or 0
    cash = fundamentals.get("cash") or 0
    net_debt = total_debt - cash

    if fcf is None:
        return False, "fcf_missing"
    if fcf <= 0:
        return False, f"fcf_negative ({fcf:.0f})"

    if ebitda is None:
        return False, "ebitda_missing"
    if ebitda <= 0:
        return False, f"ebitda_negative ({ebitda:.0f})"

    leverage = net_debt / ebitda
    if leverage >= 4.0:
        return False, f"leverage_too_high ({leverage:.2f}x)"

    return True, ""

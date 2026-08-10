from __future__ import annotations

from typing import Any


def _shortlist_sort_key(row: dict[str, Any]) -> tuple[float, int, str]:
    composite_z = row.get("composite_z")
    rank = row.get("rank")
    symbol = str(row.get("symbol") or "")
    composite_sort = -float(composite_z) if composite_z is not None else float("inf")
    rank_sort = int(rank) if rank is not None else 10**9
    return (composite_sort, rank_sort, symbol)


def select_actionable_shortlist_rows(
    *,
    factor_rows: list[dict[str, Any]],
    entry_signal_rows: list[dict[str, Any]],
    shortlist_size: int,
) -> list[dict[str, Any]]:
    actionable_symbols = {
        row["symbol"]
        for row in entry_signal_rows
        if row.get("symbol") and row.get("actionable")
    }

    ranked_actionable = [
        dict(row)
        for row in factor_rows
        if row.get("hard_filter_pass")
        and row.get("rank") is not None
        and row.get("symbol") in actionable_symbols
    ]
    ranked_actionable.sort(key=_shortlist_sort_key)

    shortlisted: list[dict[str, Any]] = []
    for index, row in enumerate(ranked_actionable[:shortlist_size], start=1):
        enriched = dict(row)
        enriched["shortlist_rank"] = index
        shortlisted.append(enriched)

    return shortlisted

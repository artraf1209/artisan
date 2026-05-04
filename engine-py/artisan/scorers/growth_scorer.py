from __future__ import annotations

import numpy as np
import pandas as pd

from artisan.scorers.zscore import mean_of_zscores, zscore_sector_neutral


def _cagr(current: float, past: float, years: int) -> float | None:
    """Annualized growth rate. Returns None if inputs invalid."""
    if not past or not current or years <= 0:
        return None
    if past < 0 or current < 0:
        return None  # CAGR undefined for sign changes
    try:
        return (current / past) ** (1.0 / years) - 1
    except (ZeroDivisionError, OverflowError):
        return None


def compute_growth_scores(
    fund_df: pd.DataFrame,
    income_history: dict[str, list[dict]],
    sectors: pd.Series,
) -> pd.Series:
    """
    Growth_score = mean of sector-neutral z-scores of:
      SalesGrowth_3y = (revenue[t] / revenue[t-3y])^(1/3) - 1
      EPSGrowth_3y   = (eps[t] / eps[t-3y])^(1/3) - 1   (only if both positive)
      FCFGrowth_3y   = (fcf[t] / fcf[t-3y])^(1/3) - 1   (only if both positive)

    income_history: {symbol: [latest annual fundamentals rows from DB, newest first]}.
    fund_df: latest fundamentals per symbol (index=symbol).
    """
    sales_growth: dict[str, float] = {}
    eps_growth: dict[str, float] = {}
    fcf_growth: dict[str, float] = {}

    for symbol, rows in income_history.items():
        if len(rows) < 4:
            continue
        latest, oldest = rows[0], rows[3]  # rows[0]=most recent, rows[3]=3y ago

        sg = _cagr(latest.get("revenue"), oldest.get("revenue"), 3)
        if sg is not None:
            sales_growth[symbol] = sg

        eg = _cagr(latest.get("eps"), oldest.get("eps"), 3)
        if eg is not None:
            eps_growth[symbol] = eg

        fcf_now = fund_df.loc[symbol, "fcf"] if symbol in fund_df.index and "fcf" in fund_df.columns else None
        fcf_old = oldest.get("fcf")
        if fcf_now is not None and fcf_old is not None:
            fg = _cagr(float(fcf_now), float(fcf_old), 3)
            if fg is not None:
                fcf_growth[symbol] = fg

    components: list[pd.Series] = []

    def _add(d: dict[str, float]) -> None:
        if len(d) < 2:
            return
        s = pd.Series(d)
        s = s.replace([np.inf, -np.inf], float("nan")).dropna()
        common = s.index.intersection(sectors.index)
        if len(common) < 2:
            return
        z = zscore_sector_neutral(s.loc[common], sectors.loc[common])
        components.append(z.reindex(sectors.index))

    _add(sales_growth)
    _add(eps_growth)
    _add(fcf_growth)

    if not components:
        return pd.Series(float("nan"), index=sectors.index)

    return mean_of_zscores(*components)

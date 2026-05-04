from __future__ import annotations

import pandas as pd

from artisan.scorers.zscore import mean_of_zscores, zscore_sector_neutral


def compute_value_scores(
    fund_df: pd.DataFrame,
    sectors: pd.Series,
) -> pd.Series:
    """
    Value_score = mean of sector-neutral z-scores of:
      EarningsYield = net_income / market_cap
      BookYield     = book_equity / market_cap
      SalesYield    = revenue / market_cap
      FCFYield      = fcf / EV  (EV = market_cap + total_debt - cash)
      EBITDAYield   = ebitda / EV

    Higher yield = cheaper = better (all "higher is better" metrics).
    fund_df index = symbol.
    Returns pd.Series(index=symbol, values=value_z).
    """
    mktcap = fund_df["market_cap"].replace(0, float("nan"))
    ev = (mktcap + fund_df.get("total_debt", pd.Series(0.0, index=fund_df.index)).fillna(0)
          - fund_df.get("cash", pd.Series(0.0, index=fund_df.index)).fillna(0))
    ev = ev.replace(0, float("nan"))

    components: list[pd.Series] = []

    ey = fund_df["net_income"] / mktcap
    if ey.notna().sum() >= 2:
        components.append(zscore_sector_neutral(ey.dropna(), sectors[ey.notna()]))

    by = fund_df["book_equity"] / mktcap
    if by.notna().sum() >= 2:
        components.append(zscore_sector_neutral(by.dropna(), sectors[by.notna()]))

    sy = fund_df["revenue"] / mktcap
    if sy.notna().sum() >= 2:
        components.append(zscore_sector_neutral(sy.dropna(), sectors[sy.notna()]))

    if "fcf" in fund_df.columns:
        fcfy = fund_df["fcf"] / ev
        if fcfy.notna().sum() >= 2:
            components.append(zscore_sector_neutral(fcfy.dropna(), sectors[fcfy.notna()]))

    if "ebitda" in fund_df.columns:
        ebity = fund_df["ebitda"] / ev
        if ebity.notna().sum() >= 2:
            components.append(zscore_sector_neutral(ebity.dropna(), sectors[ebity.notna()]))

    if not components:
        return pd.Series(float("nan"), index=fund_df.index)

    # Reindex each component to full universe (NaN for missing symbols)
    reindexed = [c.reindex(fund_df.index) for c in components]
    return mean_of_zscores(*reindexed)

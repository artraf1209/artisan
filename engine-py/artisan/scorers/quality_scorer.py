from __future__ import annotations

import pandas as pd

from artisan.scorers.zscore import mean_of_zscores, zscore_sector_neutral


def compute_quality_scores(
    fund_df: pd.DataFrame,
    sectors: pd.Series,
) -> pd.Series:
    """
    Quality_score = mean of:
      Profitability sub-score (higher = better):
        GrossProfitability = gross_profit / total_assets
        ROA                = net_income / total_assets
        ROE                (already in fund_df)
        CashFlowMargin     = operating_cash_flow / revenue
        Accruals           = -(net_income - operating_cash_flow) / total_assets  (negative = better)

      Safety/Leverage sub-score (lower leverage = better, so flip signs):
        Leverage           = -total_debt / total_assets
        InterestCoverage   = ebitda / interest_expense      (higher = better, no flip)
        NetDebtToEBITDA    = -(total_debt - cash) / ebitda
    """
    components: list[pd.Series] = []

    def _add(series: pd.Series, sectors_: pd.Series) -> None:
        valid = series.replace([float("inf"), float("-inf")], float("nan")).dropna()
        if valid.notna().sum() >= 2:
            components.append(zscore_sector_neutral(valid, sectors_[valid.index]).reindex(fund_df.index))

    # ── Profitability ──────────────────────────────────────────────────────
    assets = fund_df.get("total_assets", pd.Series(dtype=float)).replace(0, float("nan"))

    if "gross_profit" in fund_df.columns:
        _add(fund_df["gross_profit"] / assets, sectors)

    if "net_income" in fund_df.columns:
        _add(fund_df["net_income"] / assets, sectors)     # ROA

    if "roe" in fund_df.columns:
        _add(fund_df["roe"], sectors)

    revenue = fund_df.get("revenue", pd.Series(dtype=float)).replace(0, float("nan"))
    if "operating_cash_flow" in fund_df.columns:
        _add(fund_df["operating_cash_flow"] / revenue, sectors)

    if "operating_cash_flow" in fund_df.columns and "net_income" in fund_df.columns:
        accruals = -(fund_df["net_income"] - fund_df["operating_cash_flow"]) / assets
        _add(accruals, sectors)

    # ── Safety / Leverage ──────────────────────────────────────────────────
    debt = fund_df.get("total_debt", pd.Series(dtype=float)).fillna(0)
    cash = fund_df.get("cash", pd.Series(dtype=float)).fillna(0)
    ebitda = fund_df.get("ebitda", pd.Series(dtype=float)).replace(0, float("nan"))

    _add(-debt / assets, sectors)   # Leverage (negative = higher leverage = lower quality)

    if "interest_expense" in fund_df.columns:
        iexp = fund_df["interest_expense"].replace(0, float("nan"))
        _add(ebitda / iexp, sectors)   # Interest coverage

    _add(-(debt - cash) / ebitda, sectors)   # Net debt / EBITDA (flipped)

    if not components:
        return pd.Series(float("nan"), index=fund_df.index)

    return mean_of_zscores(*components)

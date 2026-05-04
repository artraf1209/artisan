from __future__ import annotations

import numpy as np
import pandas as pd

from artisan.scorers.zscore import mean_of_zscores, zscore_sector_neutral


def compute_low_vol_scores(
    price_df: pd.DataFrame,
    spy_series: pd.Series,
    sectors: pd.Series,
) -> pd.Series:
    """
    LowVol_score = mean(-z(RealizedVol_252), -z(Beta_60m))
    Lower volatility / beta = better → flip sign before z-scoring.

    price_df: wide DataFrame, columns=symbols, index=date ascending.
    spy_series: pd.Series of SPY closes, index=date.
    sectors: pd.Series(index=symbol, values=sector).
    """
    components: list[pd.Series] = []

    # ── Realized volatility (252-day) ────────────────────────────────────
    if len(price_df) >= 253:
        log_ret = np.log(price_df / price_df.shift(1)).iloc[-252:]
        rvol = log_ret.std(ddof=1) * np.sqrt(252)
        rvol = rvol.replace([np.inf, -np.inf], float("nan")).dropna()
        if rvol.notna().sum() >= 2:
            common = rvol.index.intersection(sectors.index)
            neg_rvol = -rvol.loc[common]
            z = zscore_sector_neutral(neg_rvol, sectors.loc[common])
            components.append(z.reindex(sectors.index))

    # ── Beta (60-month rolling) ───────────────────────────────────────────
    # Build monthly returns from daily price_df and spy_series
    if len(price_df) >= 60 and spy_series is not None and len(spy_series) >= 60:
        # Align spy to stock dates
        aligned_spy = spy_series.reindex(price_df.index, method="ffill")

        # Resample to monthly (last day of month)
        monthly_stocks = price_df.resample("ME").last().pct_change().dropna()
        monthly_spy = aligned_spy.resample("ME").last().pct_change().dropna()

        if len(monthly_stocks) >= 60 and len(monthly_spy) >= 60:
            spy_m = monthly_spy.iloc[-60:]
            stocks_m = monthly_stocks.iloc[-60:]
            spy_var = spy_m.var(ddof=1)

            if spy_var > 0:
                betas = {}
                for sym in stocks_m.columns:
                    s = stocks_m[sym].dropna()
                    common_idx = s.index.intersection(spy_m.index)
                    if len(common_idx) >= 30:
                        cov = s.loc[common_idx].cov(spy_m.loc[common_idx])
                        betas[sym] = cov / spy_var

                if len(betas) >= 2:
                    beta_s = pd.Series(betas)
                    neg_beta = -beta_s
                    common = neg_beta.index.intersection(sectors.index)
                    z = zscore_sector_neutral(neg_beta.loc[common], sectors.loc[common])
                    components.append(z.reindex(sectors.index))

    if not components:
        return pd.Series(float("nan"), index=sectors.index)

    return mean_of_zscores(*components)

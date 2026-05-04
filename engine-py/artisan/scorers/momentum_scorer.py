from __future__ import annotations

import numpy as np
import pandas as pd

from artisan.scorers.zscore import zscore_sector_neutral


def compute_momentum_scores(
    price_df: pd.DataFrame,
    sectors: pd.Series,
) -> pd.Series:
    """
    Momentum_score = sector-neutral z-score of Mom_12_1.
    Mom_12_1 = (Close[t-21] / Close[t-252]) - 1
      (12-month return skipping the most recent month to avoid short-term reversal)

    price_df: wide DataFrame with columns=symbols, index=date (ascending).
    sectors: pd.Series(index=symbol, values=sector_name).
    Returns pd.Series(index=symbol).
    """
    if price_df.empty or len(price_df) < 253:
        return pd.Series(float("nan"), index=sectors.index)

    # Use the last available row as "today"
    close_today = price_df.iloc[-1]           # t
    close_1m = price_df.iloc[-22] if len(price_df) >= 22 else price_df.iloc[0]    # t-21
    close_12m = price_df.iloc[-253] if len(price_df) >= 253 else price_df.iloc[0]  # t-252

    mom = (close_1m / close_12m) - 1
    mom = mom.replace([np.inf, -np.inf], float("nan")).dropna()

    if mom.notna().sum() < 2:
        return pd.Series(float("nan"), index=sectors.index)

    common = mom.index.intersection(sectors.index)
    mom = mom.loc[common]
    secs = sectors.loc[common]

    result = zscore_sector_neutral(mom, secs)
    return result.reindex(sectors.index)

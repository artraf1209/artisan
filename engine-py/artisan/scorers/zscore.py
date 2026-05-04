from __future__ import annotations

import pandas as pd


def zscore_sector_neutral(values: pd.Series, sectors: pd.Series) -> pd.Series:
    """
    Cross-sectional z-score within each sector, winsorized at 1/99 pct, clipped [-3, 3].
    Handles sectors with only one member (returns 0 for that member).
    """
    out = pd.Series(index=values.index, dtype=float)
    for _sec, group in values.groupby(sectors):
        if len(group) < 2:
            out.loc[group.index] = 0.0
            continue
        lo, hi = group.quantile([0.01, 0.99])
        clipped = group.clip(lo, hi)
        std = clipped.std(ddof=1)
        if std == 0 or pd.isna(std):
            out.loc[group.index] = 0.0
        else:
            out.loc[group.index] = (clipped - clipped.mean()) / std
    return out.clip(-3.0, 3.0)


def zscore_simple(values: pd.Series) -> pd.Series:
    """Universe-wide z-score (no sector grouping), winsorized, clipped [-3, 3]."""
    lo, hi = values.quantile([0.01, 0.99])
    clipped = values.clip(lo, hi)
    std = clipped.std(ddof=1)
    if std == 0 or pd.isna(std):
        return pd.Series(0.0, index=values.index)
    return ((clipped - clipped.mean()) / std).clip(-3.0, 3.0)


def mean_of_zscores(*series: pd.Series) -> pd.Series:
    """
    Average z-scores across multiple series, ignoring NaN per row.
    Each input series should already be z-scored.
    """
    df = pd.concat(series, axis=1)
    return df.mean(axis=1, skipna=True)

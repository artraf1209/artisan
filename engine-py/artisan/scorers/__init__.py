"""Scoring modules for the Artisan hybrid engine.

TechnicalScorer is the one survivor of the legacy 3-pillar scorer set — its
compute_indicator_snapshot()/save_indicator_values() are genuinely reused by
v2's score.py to populate indicator_values (composite/fundamental/sentiment
scorers were fully superseded by the v2 factor suite and AI agents, and are
deleted alongside this cleanup).
"""

from artisan.scorers.technical import TechnicalScorer

__all__ = [
    "TechnicalScorer",
]

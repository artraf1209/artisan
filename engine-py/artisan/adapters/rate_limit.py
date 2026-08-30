from __future__ import annotations

import time


class RateLimiter:
    """Enforces a minimum interval between calls to `pace()` so a tight loop
    of sequential requests (e.g. one nightly-ingest fundamentals/news pass
    across the whole active universe) can't burst past an external API's
    rate limit -- reactive retry-on-429 alone isn't enough once a burst is
    large enough to keep tripping the limit before backoff catches up.

    `requests_per_second <= 0` disables pacing entirely -- used by tests
    (constructed with 0 so suites stay fast and deterministic) and by
    anyone who genuinely has no limit to respect.
    """

    def __init__(self, requests_per_second: float) -> None:
        self._min_interval = 1.0 / requests_per_second if requests_per_second > 0 else 0.0
        self._last_call_at: float | None = None

    def pace(self) -> None:
        if self._min_interval <= 0:
            return
        now = time.monotonic()
        if self._last_call_at is not None:
            wait = self._min_interval - (now - self._last_call_at)
            if wait > 0:
                time.sleep(wait)
        self._last_call_at = time.monotonic()

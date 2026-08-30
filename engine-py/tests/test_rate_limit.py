from __future__ import annotations

import time

from artisan.adapters.rate_limit import RateLimiter


def test_pace_does_not_sleep_on_first_call() -> None:
    limiter = RateLimiter(requests_per_second=1.0)
    start = time.monotonic()
    limiter.pace()
    assert time.monotonic() - start < 0.05


def test_pace_enforces_minimum_interval_between_calls() -> None:
    limiter = RateLimiter(requests_per_second=20.0)  # 50ms minimum interval
    limiter.pace()
    start = time.monotonic()
    limiter.pace()
    elapsed = time.monotonic() - start
    assert elapsed >= 0.045  # small tolerance below the exact 50ms


def test_pace_does_not_sleep_if_enough_time_already_passed() -> None:
    limiter = RateLimiter(requests_per_second=1000.0)  # 1ms minimum interval
    limiter.pace()
    time.sleep(0.02)
    start = time.monotonic()
    limiter.pace()
    assert time.monotonic() - start < 0.01


def test_zero_or_negative_rate_disables_pacing() -> None:
    for rate in (0.0, -1.0):
        limiter = RateLimiter(requests_per_second=rate)
        limiter.pace()
        start = time.monotonic()
        limiter.pace()
        limiter.pace()
        assert time.monotonic() - start < 0.01

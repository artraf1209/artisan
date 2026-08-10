from __future__ import annotations

import asyncio
import logging

from artisan.agents.position_review import review_positions
from artisan.config import settings
from artisan.jobs.common import pipeline_job
from artisan.strategy_params import get_strategy_params

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def main() -> None:
    with pipeline_job("review_positions") as (db, run_id):
        strategy_params = get_strategy_params(settings.strategy_id, db=db)
        result = asyncio.run(review_positions(run_id=run_id, strategy_params=strategy_params, db=db))
        logger.info("review_positions: %s", result)


if __name__ == "__main__":
    main()

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from artisan.config import settings
from artisan.db.client import get_client

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def write_audit_log(
    db,
    *,
    actor: str,
    action: str,
    entity: str,
    payload: dict[str, Any],
    entity_id: str | None = None,
) -> None:
    db.table("audit_log").insert(
        {
            "actor": actor,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "payload": payload,
        }
    ).execute()


class IntentExecutor:
    def __init__(self, db=None) -> None:
        self.db = db or get_client()
        self.supabase_url = settings.supabase_url

    def fetch_scheduled_intents(self) -> list[dict[str, Any]]:
        """Fetch all trade_intents with status='scheduled'."""
        response = (
            self.db.table("trade_intents")
            .select("*")
            .eq("status", "scheduled")
            .order("created_at", ascending=True)
            .execute()
        )
        return response.data

    def execute_intent(self, intent: dict[str, Any]) -> dict[str, Any]:
        """Execute a single trade intent via the execute-trade edge function."""
        intent_id = intent["id"]
        symbol = intent["symbol"]
        side = intent["side"]
        quantity = intent["quantity"]
        signal_id = intent.get("signal_id")

        # Call execute-trade edge function
        response = httpx.post(
            f"{self.supabase_url}/functions/v1/execute-trade",
            json={
                "intentId": intent_id,
                "signalId": signal_id,
                "symbol": symbol,
                "side": side,
                "quantity": quantity,
                "orderType": "market",
            },
            headers={
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
        )

        result = response.json()

        if not response.is_success or result.get("error"):
            error_type = result.get("error_type", "other")
            error_msg = result.get("error", "Unknown error")
            raise RuntimeError(f"{error_type}: {error_msg}")

        return {
            "intent_id": intent_id,
            "symbol": symbol,
            "status": result.get("trade", {}).get("status", "submitted"),
            "executed_at": datetime.now(UTC).isoformat(),
        }

    def update_intent_status(self, intent_id: str, status: str) -> None:
        """Update the status of a trade intent."""
        self.db.table("trade_intents").update({"status": status}).eq("id", intent_id).execute()

    def run(self) -> dict[str, Any]:
        """Process all scheduled trade intents."""
        intents = self.fetch_scheduled_intents()
        
        processed = 0
        succeeded = 0
        failed = 0
        market_closed = 0

        for intent in intents:
            try:
                result = self.execute_intent(intent)
                
                # Update status based on execution result
                new_status = result.get("status", "submitted")
                if new_status == "filled":
                    self.update_intent_status(intent["id"], "filled")
                    succeeded += 1
                else:
                    self.update_intent_status(intent["id"], "submitted")
                    succeeded += 1
                    
                processed += 1
                
            except httpx.HTTPStatusError as exc:
                error_text = exc.response.text
                error_type = "other"
                
                # Try to parse error_type from response
                try:
                    error_data = exc.response.json()
                    error_type = error_data.get("error_type", "other")
                except Exception:
                    pass
                
                if error_type == "market_closed":
                    # Keep as scheduled - will retry on next run
                    market_closed += 1
                    logger.info(
                        "Market closed for %s, will retry later",
                        intent["symbol"],
                    )
                else:
                    # Mark as rejected
                    self.update_intent_status(intent["id"], "rejected")
                    failed += 1
                    
                    write_audit_log(
                        self.db,
                        actor="process-intents",
                        action="execute_failed",
                        entity="trade_intents",
                        entity_id=intent["id"],
                        payload={
                            "symbol": intent["symbol"],
                            "error": error_text,
                            "error_type": error_type,
                        },
                    )
                    logger.error(
                        "Failed to execute %s: %s",
                        intent["symbol"],
                        error_text,
                    )
            except Exception as exc:
                self.update_intent_status(intent["id"], "rejected")
                failed += 1
                
                write_audit_log(
                    self.db,
                    actor="process-intents",
                    action="execute_error",
                    entity="trade_intents",
                    entity_id=intent["id"],
                    payload={
                        "symbol": intent["symbol"],
                        "error": str(exc),
                    },
                )
                logger.exception("Unexpected error executing %s", intent["symbol"])

        summary = {
            "intents_found": len(intents),
            "processed": processed,
            "succeeded": succeeded,
            "failed": failed,
            "market_closed": market_closed,
            "run_at": datetime.now(UTC).isoformat(),
        }
        
        logger.info("Process intents summary: %s", summary)
        return summary


def main() -> None:
    executor = IntentExecutor()
    executor.run()


if __name__ == "__main__":
    main()
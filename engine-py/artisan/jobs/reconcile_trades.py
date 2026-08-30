from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from artisan.adapters import AlpacaOrdersAdapter
from artisan.agents.position_review import review_positions
from artisan.config import settings
from artisan.db.client import fetch_all_pages, get_client
from artisan.jobs.common import resolve_latest_completed_run_id
from artisan.strategy_params import get_strategy_params

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)

MAX_SUBMISSION_RETRIES = 3
SUBMITTING_STUCK_AFTER = timedelta(minutes=15)  # ~3x the cron cadence


def _to_float(value: Any, fallback: float | None = None) -> float | None:
    if value is None or value == "":
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


# Mirrors supabase/functions/execute-trade/index.ts's mapExecutionStatus/mapIntentStatus
# exactly -- keep both pairs in sync; a change to one side without the other is a bug.


def map_execution_status(order_status: str | None) -> str:
    status = (order_status or "pending").lower()
    if status == "filled":
        return "filled"
    if status == "partially_filled":
        return "partial"
    if status == "rejected":
        return "rejected"
    if status in ("canceled", "cancelled"):
        return "cancelled"
    if status in ("expired", "done_for_day", "stopped", "suspended"):
        return "expired"
    return "pending"


def map_intent_status(execution_status: str, filled_qty: float | None) -> str:
    if execution_status == "filled":
        return "filled"
    if execution_status in ("rejected", "cancelled"):
        return execution_status
    if execution_status == "expired":
        return "partial" if filled_qty is not None and filled_qty > 0 else "expired"
    return "submitted"


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


def send_alert(*, trigger: str, message: str, trade_id: str | None = None) -> None:
    """Best-effort push via the send-alert edge function -- a failed push must never
    fail the reconciliation run (mirrors daily_briefing.py's _send_telegram_notification)."""
    url = f"{settings.supabase_url}/functions/v1/send-alert"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
        "Content-Type": "application/json",
    }
    try:
        response = httpx.post(
            url,
            headers=headers,
            json={"trigger": trigger, "message": message, "tradeId": trade_id},
            timeout=15.0,
        )
        response.raise_for_status()
    except Exception:
        logger.exception("Failed to push reconciliation alert via send-alert")


class TradeReconciler:
    def __init__(self, db=None, orders_adapter: AlpacaOrdersAdapter | None = None) -> None:
        self.db = db or get_client()
        self.orders = orders_adapter or AlpacaOrdersAdapter()
        self.supabase_url = settings.supabase_url

    # ------------------------------------------------------------------
    # Pass A: submit intents that are ready (absorbs process_intents.py's job,
    # and is where engine-created sell/CLOSE intents -- now inserted at
    # status='scheduled' -- get picked up too).
    # ------------------------------------------------------------------

    def fetch_submittable_intents(self) -> list[dict[str, Any]]:
        return fetch_all_pages(
            lambda: self.db.table("trade_intents")
            .select("*")
            .or_(f"status.eq.scheduled,and(status.eq.failed,retry_count.lt.{MAX_SUBMISSION_RETRIES})")
            .order("created_at")
        )

    def submit_intent(self, intent_id: str) -> dict[str, Any]:
        response = httpx.post(
            f"{self.supabase_url}/functions/v1/execute-trade",
            json={"trade_intent_id": intent_id},
            headers={
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )
        return response.json()

    def run_submission_pass(self) -> dict[str, int]:
        intents = self.fetch_submittable_intents()
        processed = 0
        edge_function_errors = 0

        for intent in intents:
            try:
                # execute-trade fully owns status resolution (its atomic claim always
                # resolves to a final status before responding, success or not) -- this
                # job must never re-derive or re-write trade_intents.status from the
                # response. process_intents.py used to force every non-'filled' response
                # back to 'submitted', silently clobbering real rejections.
                self.submit_intent(intent["id"])
                processed += 1
            except Exception as exc:
                edge_function_errors += 1
                logger.warning("Failed to reach execute-trade for intent %s: %s", intent["id"], exc)
                write_audit_log(
                    self.db,
                    actor="reconcile-trades",
                    action="submit_edge_function_error",
                    entity="trade_intents",
                    entity_id=intent["id"],
                    payload={"symbol": intent.get("symbol"), "error": str(exc)},
                )

        return {
            "submittable_found": len(intents),
            "processed": processed,
            "edge_function_errors": edge_function_errors,
        }

    # ------------------------------------------------------------------
    # Pass A: orphan sweep -- narrow defense-in-depth net for the one case
    # execute-trade deliberately leaves unresolved (its own recovery lookup
    # failing after an ambiguous submission failure), plus the job/process
    # being killed mid-claim.
    # ------------------------------------------------------------------

    def fetch_orphaned_submitting_intents(self) -> list[dict[str, Any]]:
        cutoff = (datetime.now(UTC) - SUBMITTING_STUCK_AFTER).isoformat()
        return fetch_all_pages(
            lambda: self.db.table("trade_intents")
            .select("*")
            .eq("status", "submitting")
            .lt("last_attempted_at", cutoff)
            .order("last_attempted_at")
        )

    def run_orphan_sweep(self) -> dict[str, int]:
        intents = self.fetch_orphaned_submitting_intents()
        adopted = 0
        marked_failed = 0
        inconclusive = 0

        for intent in intents:
            try:
                order = self.orders.get_order_by_client_order_id(intent["id"])
            except Exception as exc:
                inconclusive += 1
                logger.warning("Orphan sweep lookup failed for intent %s: %s", intent["id"], exc)
                self._handle_inconclusive_orphan(intent)
                continue

            if order is not None:
                self._adopt_recovered_order(intent, order)
                adopted += 1
                continue

            new_retry_count = (intent.get("retry_count") or 0) + 1
            self.db.table("trade_intents").update(
                {"status": "failed", "retry_count": new_retry_count}
            ).eq("id", intent["id"]).eq("status", "submitting").execute()
            marked_failed += 1
            write_audit_log(
                self.db,
                actor="reconcile-trades",
                action="orphan_marked_failed",
                entity="trade_intents",
                entity_id=intent["id"],
                payload={"symbol": intent.get("symbol"), "retry_count": new_retry_count},
            )

        return {
            "orphans_found": len(intents),
            "adopted": adopted,
            "marked_failed": marked_failed,
            "inconclusive": inconclusive,
        }

    def _handle_inconclusive_orphan(self, intent: dict[str, Any]) -> None:
        """After repeated inconclusive lookups (broker unreachable each time), force a
        resolution rather than leaving the intent stuck at 'submitting' forever."""
        sweep_attempts = int((intent.get("overrides") or {}).get("_orphan_sweep_attempts", 0)) + 1
        merged_overrides = {**(intent.get("overrides") or {}), "_orphan_sweep_attempts": sweep_attempts}

        if sweep_attempts < 3:
            self.db.table("trade_intents").update({"overrides": merged_overrides}).eq(
                "id", intent["id"]
            ).eq("status", "submitting").execute()
            return

        new_retry_count = (intent.get("retry_count") or 0) + 1
        self.db.table("trade_intents").update(
            {"status": "failed", "retry_count": new_retry_count, "overrides": merged_overrides}
        ).eq("id", intent["id"]).eq("status", "submitting").execute()
        write_audit_log(
            self.db,
            actor="reconcile-trades",
            action="orphan_forced_failed",
            entity="trade_intents",
            entity_id=intent["id"],
            payload={"symbol": intent.get("symbol"), "note": "broker state unconfirmed after repeated attempts"},
        )
        send_alert(
            trigger="trade_reconciliation",
            message=(
                f"{intent.get('symbol')}: could not confirm broker state for trade_intent "
                f"{intent['id']} after repeated attempts -- manual verification required."
            ),
            trade_id=intent["id"],
        )

    def _adopt_recovered_order(self, intent: dict[str, Any], order: dict[str, Any]) -> None:
        execution_status = map_execution_status(order.get("status"))
        filled_qty = _to_float(order.get("filled_qty"))
        intent_status = map_intent_status(execution_status, filled_qty)

        self.db.table("trade_executions").insert(
            {
                "intent_id": intent["id"],
                "broker_order_id": order.get("id"),
                "filled_qty": filled_qty,
                "filled_price": _to_float(order.get("filled_avg_price")),
                "filled_at": order.get("filled_at") or order.get("updated_at"),
                "fees": 0,
                "status": execution_status,
                "leg_type": "entry" if intent.get("order_class") == "bracket" else None,
                "raw_response": order,
            }
        ).execute()

        self.db.table("trade_intents").update({"status": intent_status}).eq("id", intent["id"]).eq(
            "status", "submitting"
        ).execute()
        intent["status"] = intent_status

        if execution_status in ("filled", "expired"):
            self._sync_position_and_outcomes(intent, order, execution_status, filled_qty, leg_type="entry")
            if intent.get("order_class") == "bracket" and intent_status in ("filled", "partial"):
                self._discover_bracket_legs(intent, order)

    # ------------------------------------------------------------------
    # Pass B: poll every open execution for a status change.
    # ------------------------------------------------------------------

    def fetch_open_executions(self) -> list[dict[str, Any]]:
        return fetch_all_pages(
            lambda: self.db.table("trade_executions")
            .select("*,trade_intents(*)")
            .in_("status", ["pending", "partial"])
            .order("created_at")
        )

    def run_poll_pass(self) -> dict[str, int]:
        executions = self.fetch_open_executions()
        updated = 0
        unchanged = 0
        errors = 0

        for execution in executions:
            intent = execution.get("trade_intents")
            if not intent or not execution.get("broker_order_id"):
                continue

            try:
                order = self.orders.get_order(execution["broker_order_id"])
            except Exception as exc:
                errors += 1
                logger.warning("Poll failed for execution %s: %s", execution["id"], exc)
                continue

            new_broker_order_id = order.get("id")
            execution_status = map_execution_status(order.get("status"))
            filled_qty = _to_float(order.get("filled_qty"))
            filled_price = _to_float(order.get("filled_avg_price"))
            broker_order_id_changed = new_broker_order_id != execution["broker_order_id"]

            if execution_status == execution["status"] and filled_qty == _to_float(execution.get("filled_qty")) and not broker_order_id_changed:
                unchanged += 1
                continue

            update_fields: dict[str, Any] = {
                "status": execution_status,
                "filled_qty": filled_qty,
                "filled_price": filled_price,
                "filled_at": order.get("filled_at") or order.get("updated_at"),
                "raw_response": order,
            }
            if broker_order_id_changed:
                # A `replaced` order chain was followed -- track the current id.
                update_fields["broker_order_id"] = new_broker_order_id
            self.db.table("trade_executions").update(update_fields).eq("id", execution["id"]).execute()

            intent_status = map_intent_status(execution_status, filled_qty)
            if intent.get("status") != intent_status and intent.get("status") not in ("filled", "cancelled", "rejected"):
                self.db.table("trade_intents").update({"status": intent_status}).eq("id", intent["id"]).execute()
                intent["status"] = intent_status

            updated += 1
            leg_type = execution.get("leg_type")

            if execution_status in ("filled", "expired"):
                self._sync_position_and_outcomes(intent, order, execution_status, filled_qty, leg_type)
                if leg_type == "entry" and intent.get("order_class") == "bracket" and intent_status in ("filled", "partial"):
                    self._discover_bracket_legs(intent, order)

            if leg_type in ("stop_loss", "take_profit") and execution_status == "filled":
                self._resolve_decision_outcome(intent, leg_type, filled_price)
            # A leg found `cancelled` here is Alpaca's own OCO auto-cancellation firing
            # (the sibling leg filled) -- expected and benign, no alert needed.

        return {"open_found": len(executions), "updated": updated, "unchanged": unchanged, "errors": errors}

    # ------------------------------------------------------------------
    # Shared post-fill sync -- mirrors execute-trade's syncPortfolioPosition /
    # updateRecommendationAndOutcome / updatePositionReviewOutcome. Duplicated here
    # deliberately rather than calling back into execute-trade (see plan Part 3):
    # this keeps execute-trade as the sole order-*placement* path while this job only
    # ever reads from Alpaca and writes to Supabase directly, matching the existing
    # direct-write idiom already used by review_positions.py.
    # ------------------------------------------------------------------

    def _sync_position_and_outcomes(
        self,
        intent: dict[str, Any],
        order: dict[str, Any],
        execution_status: str,
        filled_qty: float | None,
        leg_type: str | None,
    ) -> None:
        self._sync_portfolio_position(intent, opened_at_override=order.get("filled_at"))

        intent_status = map_intent_status(execution_status, filled_qty)
        if intent.get("side") != "buy" or (leg_type is not None and leg_type != "entry"):
            return

        filled_price = _to_float(order.get("filled_avg_price"))
        overrides = intent.get("overrides") or {}
        override_source_type = overrides.get("source_type")
        override_source_id = overrides.get("source_id")

        if intent_status == "filled":
            if override_source_type == "position_review" and override_source_id:
                self._update_position_review_outcome(override_source_id, filled_price, intent)
            elif intent.get("signal_id"):
                self._update_recommendation_and_outcome(intent["signal_id"], filled_price, intent)
        elif intent_status == "partial":
            send_alert(
                trigger="trade_reconciliation",
                message=(
                    f"{intent['symbol']}: order expired with a partial fill "
                    f"({filled_qty}/{intent.get('quantity')} shares). No automatic "
                    f"resubmission will occur -- review and decide on the remainder manually."
                ),
                trade_id=intent["id"],
            )
        elif intent_status == "expired" and intent.get("signal_id"):
            self.db.table("recommendations").update({"status": "expired"}).eq(
                "id", intent["signal_id"]
            ).execute()

    def _sync_portfolio_position(self, intent: dict[str, Any], *, opened_at_override: str | None = None) -> None:
        alpaca_position = self.orders.get_position(intent["symbol"])
        self._apply_alpaca_position(
            intent["account_id"],
            intent["symbol"],
            alpaca_position,
            stop_price_override=_to_float(intent.get("stop_price")),
            signal_id_override=intent.get("signal_id"),
            opened_at_override=opened_at_override,
        )

    def _apply_alpaca_position(
        self,
        account_id: str,
        symbol: str,
        alpaca_position: dict[str, Any] | None,
        *,
        stop_price_override: float | None = None,
        signal_id_override: str | None = None,
        opened_at_override: str | None = None,
    ) -> None:
        """Upserts (or deletes, if Alpaca no longer reports it) one portfolio_positions
        row from Alpaca's live position data. `stop_price_override`/`signal_id_override`
        are only ever supplied by the per-intent sync path (a just-placed order carries
        fresher values) -- the periodic all-positions refresh calls this with neither,
        so it only ever touches quantity/avg_entry_price/current_price/unrealized_pnl
        and leaves our own risk-management fields (stop/target/signal_id/order ids)
        untouched, since none of those come from Alpaca's position response anyway."""
        existing_rows = (
            self.db.table("portfolio_positions")
            .select("signal_id,stop_price,target_price,entry_order_id,stop_order_id,target_order_id,opened_at")
            .eq("account_id", account_id)
            .eq("symbol", symbol)
            .limit(1)
            .execute()
            .data
        )
        existing = existing_rows[0] if existing_rows else {}

        current_qty = _to_float((alpaca_position or {}).get("qty"), 0.0) or 0.0
        if alpaca_position is None or current_qty <= 0:
            self.db.table("portfolio_positions").delete().eq("account_id", account_id).eq(
                "symbol", symbol
            ).execute()
            return

        row = {
            "account_id": account_id,
            "symbol": symbol,
            "quantity": current_qty,
            "avg_entry_price": _to_float(alpaca_position.get("avg_entry_price"), 0.0),
            "current_price": _to_float(alpaca_position.get("current_price")),
            "unrealized_pnl": _to_float(alpaca_position.get("unrealized_pl")),
            "stop_price": stop_price_override or existing.get("stop_price"),
            "target_price": existing.get("target_price"),
            "signal_id": existing.get("signal_id") or signal_id_override,
            "entry_order_id": existing.get("entry_order_id"),
            "stop_order_id": existing.get("stop_order_id"),
            "target_order_id": existing.get("target_order_id"),
            # An upsert must carry opened_at for inserts, but always preserves the
            # original value once a local position has been established.
            "opened_at": existing.get("opened_at") or opened_at_override or datetime.now(UTC).isoformat(),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self.db.table("portfolio_positions").upsert(row, on_conflict="account_id,symbol").execute()

    def fetch_positions_needing_initial_review(self) -> list[dict[str, Any]]:
        positions = fetch_all_pages(
            lambda: self.db.table("portfolio_positions").select("id,symbol,initial_reviewed_at").order("symbol")
        )
        return [position for position in positions if position.get("initial_reviewed_at") is None]

    def run_initial_position_review(self) -> dict[str, int]:
        """Review newly tracked positions without changing the daily run's state.

        The marker is deliberately written only after a persisted review row exists,
        which makes a transient model or database failure retry on the next cycle.
        """
        pending_positions = self.fetch_positions_needing_initial_review()
        if not pending_positions:
            return {"eligible": 0, "reviewed": 0, "errors": 0}

        try:
            run_id = resolve_latest_completed_run_id(self.db)
            strategy_params = get_strategy_params(settings.strategy_id, db=self.db)
            result = asyncio.run(review_positions(run_id=run_id, strategy_params=strategy_params, db=self.db))
            reviewed_ids = {review["position_id"] for review in result["reviews"]}
            completed_ids = {position["id"] for position in pending_positions} & reviewed_ids
            reviewed_at = datetime.now(UTC).isoformat()
            for position_id in completed_ids:
                self.db.table("portfolio_positions").update({"initial_reviewed_at": reviewed_at}).eq("id", position_id).execute()
            return {"eligible": len(pending_positions), "reviewed": len(completed_ids), "errors": 0}
        except Exception as exc:
            logger.exception("Initial position review failed")
            write_audit_log(
                self.db,
                actor="reconcile-trades",
                action="initial_position_review_failed",
                entity="portfolio_positions",
                payload={"symbols": [position["symbol"] for position in pending_positions], "error": str(exc)},
            )
            send_alert(
                trigger="trade_reconciliation",
                message="Initial Position Review failed; it will retry on the next reconciliation cycle.",
            )
            return {"eligible": len(pending_positions), "reviewed": 0, "errors": 1}

    # ------------------------------------------------------------------
    # Refresh every open position every cycle, not just ones with active order
    # flow -- otherwise a quiet position's price/P&L goes stale indefinitely.
    # ------------------------------------------------------------------

    def fetch_all_open_positions(self) -> list[dict[str, Any]]:
        return fetch_all_pages(
            lambda: self.db.table("portfolio_positions").select("account_id,symbol").order("symbol")
        )

    def run_position_refresh_pass(self) -> dict[str, int]:
        db_positions = self.fetch_all_open_positions()

        # Always check Alpaca, even with zero known positions -- orphan detection
        # (a broker-side position with nothing in our DB) must not be skipped just
        # because we don't have anything else to refresh.
        try:
            alpaca_positions = self.orders.get_all_positions()
        except Exception as exc:
            logger.warning("Failed to fetch all positions from Alpaca: %s", exc)
            return {"db_positions": len(db_positions), "refreshed": 0, "closed": 0, "orphans_alerted": 0, "errors": 1}

        alpaca_by_symbol = {p["symbol"]: p for p in alpaca_positions}
        db_symbols = {p["symbol"] for p in db_positions}

        refreshed = 0
        closed = 0
        for position in db_positions:
            alpaca_position = alpaca_by_symbol.get(position["symbol"])
            self._apply_alpaca_position(position["account_id"], position["symbol"], alpaca_position)
            if alpaca_position is None:
                closed += 1
            else:
                refreshed += 1

        # An Alpaca position with nothing in our DB (e.g. a manual trade placed outside
        # this system) is surfaced, never silently materialized -- there's no originating
        # recommendation/intent to attach it to.
        orphans_alerted = 0
        for symbol, alpaca_position in alpaca_by_symbol.items():
            if symbol in db_symbols:
                continue
            orphans_alerted += 1
            write_audit_log(
                self.db,
                actor="reconcile-trades",
                action="orphan_broker_position_detected",
                entity="portfolio_positions",
                entity_id=None,
                payload={"symbol": symbol, "qty": alpaca_position.get("qty")},
            )
            send_alert(
                trigger="trade_reconciliation",
                message=(
                    f"{symbol}: Alpaca reports an open position ({alpaca_position.get('qty')} shares) "
                    "with no matching record in this system -- manual review needed."
                ),
            )

        return {
            "db_positions": len(db_positions),
            "refreshed": refreshed,
            "closed": closed,
            "orphans_alerted": orphans_alerted,
            "errors": 0,
        }

    def _update_recommendation_and_outcome(self, recommendation_id: str, fill_price: float | None, intent: dict[str, Any]) -> None:
        rec_rows = (
            self.db.table("recommendations").select("id,target_price").eq("id", recommendation_id).limit(1).execute().data
        )
        rec = rec_rows[0] if rec_rows else {}
        self.db.table("recommendations").update({"status": "executed"}).eq("id", recommendation_id).execute()
        self.db.table("decision_outcomes").update(
            {
                "mode": "real",
                "entry_price_reference": fill_price,
                "stop_price": _to_float(intent.get("stop_price")),
                "target_price": _to_float(rec.get("target_price")),
                "updated_at": datetime.now(UTC).isoformat(),
            }
        ).eq("source_type", "recommendation").eq("source_id", recommendation_id).eq("mode", "shadow").execute()

    def _update_position_review_outcome(self, position_review_id: str, fill_price: float | None, intent: dict[str, Any]) -> None:
        pos_rows = (
            self.db.table("portfolio_positions")
            .select("target_price")
            .eq("account_id", intent["account_id"])
            .eq("symbol", intent["symbol"])
            .limit(1)
            .execute()
            .data
        )
        position = pos_rows[0] if pos_rows else {}
        self.db.table("decision_outcomes").update(
            {
                "mode": "real",
                "entry_price_reference": fill_price,
                "stop_price": _to_float(intent.get("stop_price")),
                "target_price": _to_float(position.get("target_price")),
                "updated_at": datetime.now(UTC).isoformat(),
            }
        ).eq("source_type", "position_review").eq("source_id", position_review_id).eq("mode", "shadow").execute()

    # ------------------------------------------------------------------
    # Bracket leg discovery (Part 3b): the exit legs usually don't get independent,
    # queryable order IDs until the entry leg actually fills -- this is triggered the
    # moment that fill is first observed.
    # ------------------------------------------------------------------

    def _discover_bracket_legs(self, intent: dict[str, Any], order: dict[str, Any]) -> None:
        entry_order_id = order.get("id")
        try:
            full_order = self.orders.get_order(entry_order_id)
        except Exception as exc:
            logger.warning("Failed to fetch legs for bracket entry %s: %s", entry_order_id, exc)
            return

        legs = full_order.get("legs") or []
        stop_leg = next((leg for leg in legs if _to_float(leg.get("stop_price")) is not None), None)
        target_leg = next(
            (leg for leg in legs if _to_float(leg.get("stop_price")) is None and _to_float(leg.get("limit_price")) is not None),
            None,
        )
        if not stop_leg and not target_leg:
            return  # legs not materialized yet -- a later poll pass will retry

        update_fields: dict[str, Any] = {"entry_order_id": entry_order_id}
        if stop_leg:
            update_fields["stop_order_id"] = stop_leg["id"]
        if target_leg:
            update_fields["target_order_id"] = target_leg["id"]
        self.db.table("portfolio_positions").update(update_fields).eq("account_id", intent["account_id"]).eq(
            "symbol", intent["symbol"]
        ).execute()

        existing_execution_ids = {
            row["broker_order_id"]
            for row in self.db.table("trade_executions").select("broker_order_id").eq("intent_id", intent["id"]).execute().data
            if row.get("broker_order_id")
        }
        for leg, leg_type in ((stop_leg, "stop_loss"), (target_leg, "take_profit")):
            if leg and leg["id"] not in existing_execution_ids:
                self.db.table("trade_executions").insert(
                    {
                        "intent_id": intent["id"],
                        "broker_order_id": leg["id"],
                        "filled_qty": _to_float(leg.get("filled_qty")),
                        "filled_price": _to_float(leg.get("filled_avg_price")),
                        "filled_at": leg.get("filled_at"),
                        "fees": 0,
                        "status": map_execution_status(leg.get("status")),
                        "leg_type": leg_type,
                        "raw_response": leg,
                    }
                ).execute()

    def _resolve_decision_outcome(self, intent: dict[str, Any], leg_type: str, filled_price: float | None) -> None:
        overrides = intent.get("overrides") or {}
        if overrides.get("source_type") == "position_review" and overrides.get("source_id"):
            source_type, source_id = "position_review", overrides["source_id"]
        elif intent.get("signal_id"):
            source_type, source_id = "recommendation", intent["signal_id"]
        else:
            return

        rows = (
            self.db.table("decision_outcomes")
            .select("id,entry_price_reference,stop_price,created_at")
            .eq("source_type", source_type)
            .eq("source_id", source_id)
            .eq("resolution", "still_open")
            .limit(1)
            .execute()
            .data
        )
        if not rows:
            return
        row = rows[0]

        now = datetime.now(UTC)
        created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
        days_held = (now.date() - created.date()).days
        entry = _to_float(row.get("entry_price_reference"))
        stop = _to_float(row.get("stop_price"))
        r_multiple = None
        if entry is not None and stop is not None and filled_price is not None and (entry - stop) != 0:
            r_multiple = round((filled_price - entry) / (entry - stop), 4)

        self.db.table("decision_outcomes").update(
            {
                "resolution": "hit_stop" if leg_type == "stop_loss" else "hit_target",
                "resolved_at": now.isoformat(),
                "days_to_resolution": days_held,
                "r_multiple": r_multiple,
                "updated_at": now.isoformat(),
            }
        ).eq("id", row["id"]).execute()

    # ------------------------------------------------------------------

    def run(self) -> dict[str, Any]:
        submission = self.run_submission_pass()
        orphans = self.run_orphan_sweep()
        poll = self.run_poll_pass()
        position_refresh = self.run_position_refresh_pass()
        initial_position_review = self.run_initial_position_review()
        summary = {
            "submission": submission,
            "orphan_sweep": orphans,
            "poll": poll,
            "position_refresh": position_refresh,
            "initial_position_review": initial_position_review,
            "run_at": datetime.now(UTC).isoformat(),
        }
        logger.info("Reconcile trades summary: %s", summary)
        return summary


def main() -> None:
    reconciler = TradeReconciler()
    reconciler.run()


if __name__ == "__main__":
    main()

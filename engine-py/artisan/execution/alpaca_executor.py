from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from artisan.config import settings
from artisan.db.client import get_client
from artisan.jobs.nightly_ingest import write_audit_log

logger = logging.getLogger(__name__)


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.TransportError)


class BrokerAdapter(ABC):
    @abstractmethod
    def submit_order(self, intent: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_account(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_position(self, symbol: str) -> dict[str, Any] | None:
        raise NotImplementedError


class AlpacaAdapter(BrokerAdapter):
    def __init__(
        self,
        http_client: httpx.Client | None = None,
        base_url: str | None = None,
    ) -> None:
        self.http_client = http_client or httpx.Client(timeout=30.0)
        self.base_url = (base_url or settings.alpaca_base_url).rstrip("/")
        self.headers = {
            "APCA-API-KEY-ID": settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": settings.alpaca_api_secret,
        }

    @retry(
        retry=retry_if_exception(_is_retryable_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        response = self.http_client.request(
            method,
            f"{self.base_url}{path}",
            headers=self.headers,
            **kwargs,
        )
        if response.status_code == 404 and path.startswith("/v2/positions/"):
            return response
        response.raise_for_status()
        return response

    def submit_order(self, intent: dict[str, Any]) -> dict[str, Any]:
        payload = {
            "symbol": intent["symbol"],
            "qty": str(intent["quantity"]),
            "side": intent["side"],
            "type": "market",
            "time_in_force": "day",
            "client_order_id": str(intent["id"]),
        }
        response = self._request("POST", "/v2/orders", json=payload)
        return response.json()

    def get_account(self) -> dict[str, Any]:
        response = self._request("GET", "/v2/account")
        return response.json()

    def get_position(self, symbol: str) -> dict[str, Any] | None:
        response = self._request("GET", f"/v2/positions/{symbol}")
        if response.status_code == 404:
            return None
        return response.json()


class PaperAdapter(BrokerAdapter):
    def submit_order(self, intent: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC).isoformat()
        return {
            "id": f"paper-{intent['id']}",
            "client_order_id": str(intent["id"]),
            "symbol": intent["symbol"],
            "side": intent["side"],
            "status": "filled",
            "filled_qty": str(intent["quantity"]),
            "filled_avg_price": None,
            "filled_at": now,
        }

    def get_account(self) -> dict[str, Any]:
        return {"equity": None, "cash": None}

    def get_position(self, symbol: str) -> dict[str, Any] | None:
        return {
            "symbol": symbol,
            "qty": "0",
            "avg_entry_price": None,
            "current_price": None,
            "unrealized_pl": None,
        }


class TradeExecutor:
    def __init__(self, db=None, broker: BrokerAdapter | None = None) -> None:
        self.db = db or get_client()
        self.broker = broker or AlpacaAdapter()

    def fetch_pending_intents(self) -> list[dict[str, Any]]:
        response = (
            self.db.table("trade_intents")
            .select("*")
            .eq("status", "pending")
            .order("created_at", desc=False)
            .execute()
        )
        return response.data

    def fetch_signal(self, signal_id: str) -> dict[str, Any] | None:
        response = (
            self.db.table("signal_events")
            .select("id, symbol, target_price, stop_price")
            .eq("id", signal_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_intent_status(self, intent_id: str, status: str) -> None:
        self.db.table("trade_intents").update({"status": status}).eq("id", intent_id).execute()

    def update_signal_status(self, signal_id: str, status: str) -> None:
        self.db.table("signal_events").update({"status": status}).eq("id", signal_id).execute()

    def insert_execution(self, row: dict[str, Any]) -> dict[str, Any]:
        response = self.db.table("trade_executions").insert(row).execute()
        return response.data[0] if response.data else row

    def upsert_position(self, row: dict[str, Any]) -> None:
        self.db.table("portfolio_positions").upsert(row, on_conflict="account_id,symbol").execute()

    def update_account_snapshot(self, account_id: str, account: dict[str, Any]) -> None:
        payload = {
            "equity": _to_float(account.get("equity")),
            "cash": _to_float(account.get("cash")),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self.db.table("accounts").update(payload).eq("id", account_id).execute()

    @staticmethod
    def _map_execution_status(order_status: str | None) -> str:
        status = (order_status or "pending").lower()
        if status in {"filled"}:
            return "filled"
        if status in {"partially_filled"}:
            return "partial"
        if status in {"rejected", "canceled", "cancelled"}:
            return "rejected" if status == "rejected" else "cancelled"
        return "pending"

    @staticmethod
    def _map_intent_status(execution_status: str) -> str:
        if execution_status == "filled":
            return "filled"
        if execution_status == "partial":
            return "submitted"
        if execution_status in {"cancelled", "rejected"}:
            return execution_status
        return "submitted"

    def build_execution_row(self, intent: dict[str, Any], order: dict[str, Any]) -> dict[str, Any]:
        execution_status = self._map_execution_status(order.get("status"))
        return {
            "intent_id": intent["id"],
            "broker_order_id": order.get("id"),
            "filled_qty": _to_float(order.get("filled_qty")),
            "filled_price": _to_float(order.get("filled_avg_price")),
            "filled_at": order.get("filled_at") or order.get("updated_at"),
            "fees": 0,
            "status": execution_status,
            "raw_response": order,
        }

    def sync_position(self, intent: dict[str, Any]) -> None:
        signal = self.fetch_signal(intent["signal_id"])
        position = self.broker.get_position(intent["symbol"])
        if not position:
            return

        position_row = {
            "account_id": intent["account_id"],
            "symbol": intent["symbol"],
            "quantity": _to_float(position.get("qty")) or 0,
            "avg_entry_price": _to_float(position.get("avg_entry_price")) or 0,
            "current_price": _to_float(position.get("current_price")),
            "unrealized_pnl": _to_float(position.get("unrealized_pl")),
            "stop_price": signal.get("stop_price") if signal else intent.get("stop_price"),
            "target_price": signal.get("target_price") if signal else None,
            "signal_id": intent["signal_id"],
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self.upsert_position(position_row)

    def process_intent(self, intent: dict[str, Any]) -> dict[str, Any]:
        try:
            order = self.broker.submit_order(intent)
            execution_row = self.build_execution_row(intent, order)
            saved = self.insert_execution(execution_row)
            new_intent_status = self._map_intent_status(saved["status"])

            self.update_intent_status(intent["id"], new_intent_status)
            if saved["status"] == "filled":
                self.update_signal_status(intent["signal_id"], "executed")
                self.sync_position(intent)
            elif saved["status"] in {"rejected", "cancelled"}:
                self.update_signal_status(intent["signal_id"], "approved")

            account = self.broker.get_account()
            self.update_account_snapshot(intent["account_id"], account)

            write_audit_log(
                self.db,
                actor="system",
                action="execute",
                entity="trade_executions",
                payload={
                    "intent_id": intent["id"],
                    "symbol": intent["symbol"],
                    "status": saved["status"],
                    "broker_order_id": saved.get("broker_order_id"),
                },
            )
            return saved
        except Exception as exc:
            execution_row = {
                "intent_id": intent["id"],
                "broker_order_id": None,
                "filled_qty": None,
                "filled_price": None,
                "filled_at": None,
                "fees": 0,
                "status": "rejected",
                "raw_response": {"error": str(exc)},
            }
            saved = self.insert_execution(execution_row)
            self.update_intent_status(intent["id"], "rejected")
            write_audit_log(
                self.db,
                actor="system",
                action="execute_failed",
                entity="trade_executions",
                payload={
                    "intent_id": intent["id"],
                    "symbol": intent["symbol"],
                    "error": str(exc),
                },
            )
            return saved

    def run(self) -> dict[str, Any]:
        intents = self.fetch_pending_intents()
        filled = 0
        rejected = 0

        for intent in intents:
            execution = self.process_intent(intent)
            if execution["status"] == "filled":
                filled += 1
            elif execution["status"] in {"rejected", "cancelled"}:
                rejected += 1

        summary = {
            "pending_intents": len(intents),
            "filled": filled,
            "rejected": rejected,
            "processed_at": datetime.now(UTC).isoformat(),
        }
        logger.info("Trade executor summary: %s", summary)
        return summary


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)

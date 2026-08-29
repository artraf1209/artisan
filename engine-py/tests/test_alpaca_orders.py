from __future__ import annotations

import httpx

from artisan.adapters.alpaca_orders import AlpacaOrdersAdapter


def _adapter(handler) -> AlpacaOrdersAdapter:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return AlpacaOrdersAdapter(http_client=client, base_url="https://paper-api.alpaca.markets")


def test_get_order_returns_order_directly_when_not_replaced() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/orders/order-1"
        return httpx.Response(200, json={"id": "order-1", "status": "filled"})

    adapter = _adapter(handler)
    order = adapter.get_order("order-1")

    assert order["id"] == "order-1"
    assert order["status"] == "filled"


def test_get_order_follows_replaced_by_chain_to_final_order() -> None:
    orders = {
        "order-1": {"id": "order-1", "status": "replaced", "replaced_by": "order-2"},
        "order-2": {"id": "order-2", "status": "replaced", "replaced_by": "order-3"},
        "order-3": {"id": "order-3", "status": "filled", "replaced_by": None},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        order_id = request.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, json=orders[order_id])

    adapter = _adapter(handler)
    order = adapter.get_order("order-1")

    assert order["id"] == "order-3"
    assert order["status"] == "filled"


def test_get_order_stops_following_chain_after_max_hops() -> None:
    # A pathological/circular chain must not loop forever.
    def handler(request: httpx.Request) -> httpx.Response:
        order_id = request.url.path.rsplit("/", 1)[-1]
        next_id = f"order-{int(order_id.split('-')[1]) + 1}"
        return httpx.Response(200, json={"id": order_id, "status": "replaced", "replaced_by": next_id})

    adapter = _adapter(handler)
    order = adapter.get_order("order-0")

    assert order["id"] == "order-5"


def test_get_order_by_client_order_id_returns_none_on_404() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "client_order_id" in str(request.url)
        return httpx.Response(404)

    adapter = _adapter(handler)
    assert adapter.get_order_by_client_order_id("intent-1") is None


def test_get_order_by_client_order_id_returns_order_when_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "order-1", "client_order_id": "intent-1"})

    adapter = _adapter(handler)
    order = adapter.get_order_by_client_order_id("intent-1")

    assert order == {"id": "order-1", "client_order_id": "intent-1"}


def test_get_position_returns_none_on_404() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    adapter = _adapter(handler)
    assert adapter.get_position("AAPL") is None


def test_get_position_returns_position_when_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/positions/AAPL"
        return httpx.Response(200, json={"symbol": "AAPL", "qty": "10"})

    adapter = _adapter(handler)
    position = adapter.get_position("AAPL")

    assert position["qty"] == "10"


def test_get_all_positions_returns_the_full_list_in_one_call() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        assert request.url.path == "/v2/positions"
        return httpx.Response(
            200,
            json=[
                {"symbol": "AAPL", "qty": "10"},
                {"symbol": "ABNB", "qty": "56"},
            ],
        )

    adapter = _adapter(handler)
    positions = adapter.get_all_positions()

    assert calls["count"] == 1
    assert {p["symbol"] for p in positions} == {"AAPL", "ABNB"}


def test_get_all_positions_retries_on_5xx_then_succeeds() -> None:
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] < 3:
            return httpx.Response(503)
        return httpx.Response(200, json=[{"symbol": "AAPL", "qty": "10"}])

    adapter = _adapter(handler)
    positions = adapter.get_all_positions()

    assert positions == [{"symbol": "AAPL", "qty": "10"}]
    assert attempts["count"] == 3


def test_retries_on_5xx_then_succeeds() -> None:
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"id": "order-1", "status": "filled"})

    adapter = _adapter(handler)
    order = adapter.get_order("order-1")

    assert order["status"] == "filled"
    assert attempts["count"] == 3

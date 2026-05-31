"""Tests for the IBKR connection-status helper, adapter method, and endpoint."""

import httpx

from app.adapters.ibkr import IbkrAdapter, gateway_login_url


def test_gateway_login_url_strips_v1_api_path():
    assert gateway_login_url("https://localhost:5000/v1/api") == "https://localhost:5000"


def test_gateway_login_url_preserves_host_and_port():
    assert gateway_login_url("https://127.0.0.1:5001/v1/api") == "https://127.0.0.1:5001"


def test_gateway_login_url_tolerates_trailing_slash():
    assert gateway_login_url("https://localhost:5000/v1/api/") == "https://localhost:5000"


def _adapter(handler) -> IbkrAdapter:
    a = IbkrAdapter()
    a._client = httpx.AsyncClient(
        base_url="https://gw.local/v1/api", transport=httpx.MockTransport(handler)
    )
    return a


async def test_get_auth_state_authenticated():
    a = _adapter(lambda req: httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": True}}}))
    assert await a.get_auth_state() == "authenticated"


async def test_get_auth_state_unauthenticated_when_not_logged_in():
    a = _adapter(lambda req: httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": False}}}))
    assert await a.get_auth_state() == "unauthenticated"


async def test_get_auth_state_unreachable_on_connect_error():
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=req)

    a = _adapter(handler)
    assert await a.get_auth_state() == "unreachable"


async def test_get_auth_state_unreachable_on_rate_limit():
    # A 429 from the gateway maps to RateLimited in the HTTP layer; get_auth_state
    # must still return a state (never raise), so the endpoint never 500s.
    a = _adapter(lambda req: httpx.Response(429, text="too many requests"))
    assert await a.get_auth_state() == "unreachable"


def test_ibkr_auth_endpoint_reports_state_and_login_url(monkeypatch):
    from fastapi.testclient import TestClient

    from app.adapters.ibkr import IbkrAdapter as RealAdapter
    from app.main import app

    async def fake_state(self):
        return "unauthenticated"

    monkeypatch.setattr(RealAdapter, "get_auth_state", fake_state)
    r = TestClient(app).get("/ibkr/auth")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "unauthenticated"
    assert body["loginUrl"] == "https://localhost:5000"  # from default IBKR_GATEWAY_BASE_URL
    assert isinstance(body["detail"], str) and body["detail"]


def test_ibkr_auth_endpoint_never_500s_when_unreachable(monkeypatch):
    from fastapi.testclient import TestClient

    from app.adapters.ibkr import IbkrAdapter as RealAdapter
    from app.main import app

    async def fake_state(self):
        return "unreachable"

    monkeypatch.setattr(RealAdapter, "get_auth_state", fake_state)
    r = TestClient(app).get("/ibkr/auth")
    assert r.status_code == 200
    assert r.json()["state"] == "unreachable"

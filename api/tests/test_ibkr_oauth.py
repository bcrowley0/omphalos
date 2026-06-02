import asyncio
from types import SimpleNamespace

import pytest

from app.adapters.base import Unauthenticated
from app.adapters.ibkr_transport import OAuthTransport
from app.config import Settings, resolve_ibkr_auth_mode


def _oauth_settings(**over):
    base = dict(
        ibkr_oauth_consumer_key="CONSUMER",
        ibkr_oauth_access_token="TOKEN",
        ibkr_oauth_access_token_secret="SECRET",
        ibkr_oauth_signature_key_path="/keys/sig.pem",
        ibkr_oauth_encryption_key_path="/keys/enc.pem",
        ibkr_oauth_dh_prime="ABCDEF",
    )
    base.update(over)
    return Settings(_env_file=None, **base)


def test_oauth_configured_true_when_all_present():
    assert _oauth_settings().ibkr_oauth_configured is True


def test_oauth_configured_false_when_any_missing():
    # representative: any single missing field is sufficient to be unconfigured
    assert _oauth_settings(ibkr_oauth_dh_prime=None).ibkr_oauth_configured is False


def test_mode_defaults_to_oauth_when_configured():
    assert resolve_ibkr_auth_mode(_oauth_settings()) == "oauth"


def test_mode_defaults_to_gateway_when_not_configured():
    s = Settings(_env_file=None)
    assert resolve_ibkr_auth_mode(s) == "gateway"


def test_explicit_mode_overrides_default():
    s = _oauth_settings(ibkr_auth_mode="gateway")
    assert resolve_ibkr_auth_mode(s) == "gateway"


def _oauth_cfg():
    return SimpleNamespace(consumer_key="C", access_token="T")


def test_oauth_transport_signs_and_gets(monkeypatch):
    t = OAuthTransport(_oauth_cfg())
    # Pretend a live session token already exists and the brokerage session is up.
    t._lst = "LST"
    t._lst_expires_ms = 10**18
    t._brokerage_ready = True

    captured = {}

    async def fake_get_json(path, *, source, client, **kwargs):
        captured["path"] = path
        captured["headers"] = kwargs.get("headers")
        return [{"31": "100.0"}]

    monkeypatch.setattr("app.adapters.ibkr_transport.get_json", fake_get_json)
    monkeypatch.setattr(
        "app.adapters.ibkr_transport.generate_oauth_headers",
        lambda **kw: {"Authorization": "OAuth oauth_signature=sig"},
    )

    out = asyncio.run(t.get("/iserver/marketdata/snapshot", params={"conids": "1"}))
    assert out == [{"31": "100.0"}]
    assert captured["path"] == "/iserver/marketdata/snapshot"
    assert captured["headers"]["Authorization"].startswith("OAuth ")


def test_oauth_ensure_session_fetches_lst_and_inits_brokerage(monkeypatch):
    t = OAuthTransport(_oauth_cfg())

    monkeypatch.setattr(
        "app.adapters.ibkr_transport.req_live_session_token",
        lambda client, cfg: ("LST", 10**18, "sigxyz"),
    )
    monkeypatch.setattr(
        "app.adapters.ibkr_transport.generate_oauth_headers",
        lambda **kw: {"Authorization": "OAuth x"},
    )

    posts = []

    async def fake_post_form(path, *, source, data, client=None, **kwargs):
        posts.append(path)
        if path.endswith("/ssodh/init"):
            return {"authenticated": True, "connected": True}
        return {}  # /tickle

    monkeypatch.setattr("app.adapters.ibkr_transport.post_form", fake_post_form)
    monkeypatch.setattr(OAuthTransport, "_ibind_client", lambda self: object())

    asyncio.run(t.ensure_session())
    assert t._lst == "LST"
    assert t._brokerage_ready is True
    assert any(p.endswith("/ssodh/init") for p in posts)


def test_oauth_ensure_session_bad_creds_raises_unauthenticated(monkeypatch):
    t = OAuthTransport(_oauth_cfg())

    def boom(client, cfg):
        raise RuntimeError("signature rejected")

    monkeypatch.setattr("app.adapters.ibkr_transport.req_live_session_token", boom)
    monkeypatch.setattr(OAuthTransport, "_ibind_client", lambda self: object())

    with pytest.raises(Unauthenticated) as exc:
        asyncio.run(t.ensure_session())
    assert "check api/.env" in str(exc.value)
    assert t._brokerage_ready is False

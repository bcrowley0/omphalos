"""Unit tests for the non-secret connection-status builder."""

from types import SimpleNamespace

from app.routers import build_status


def _settings(fred=None, kkey=None, ksecret=None):
    return SimpleNamespace(fred_api_key=fred, kraken_api_key=kkey, kraken_api_secret=ksecret)


def test_status_reports_unconfigured_sources():
    by = {s.source: s for s in build_status(_settings()).sources}
    assert by["fred"].configured is False
    assert by["kraken"].configured is False
    assert by["ibkr"].configured is True  # gateway-based; nothing in api/.env
    assert "FRED_API_KEY" in by["fred"].detail


def test_status_reports_configured_when_keys_present():
    by = {s.source: s for s in build_status(_settings(fred="k", kkey="a", ksecret="b")).sources}
    assert by["fred"].configured is True
    assert by["kraken"].configured is True


def test_status_kraken_needs_both_keys():
    by = {s.source: s for s in build_status(_settings(kkey="a")).sources}  # secret missing
    assert by["kraken"].configured is False


def test_status_never_leaks_key_values():
    # The detail strings must never contain a configured key's value.
    secrets = ["ZZFREDSECRET", "QXKRAKENKEY", "QXKRAKENSECRET"]
    st = build_status(_settings(fred=secrets[0], kkey=secrets[1], ksecret=secrets[2]))
    for s in st.sources:
        for secret in secrets:
            assert secret not in s.detail

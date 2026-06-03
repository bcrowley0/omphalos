"""Unit tests for the SDR (CFTC swap data repository) adapter — pure functions
plus the fetch/unzip shell (monkeypatched, no network)."""

import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models import SwapCurve, SwapTenorPoint, SwapsResponse, SourceStatus


def test_models_camel_case_on_the_wire():
    point = SwapTenorPoint(
        tenor_label="10Y", tenor_years=10.0, rate_pct=3.98, trade_count=2, total_notional=75_000_000.0
    )
    dumped = point.model_dump(by_alias=True)
    assert dumped["tenorLabel"] == "10Y"
    assert dumped["totalNotional"] == 75_000_000.0

    curve = SwapCurve(key="sofr", label="SOFR OIS", obs_date=1_700_000_000_000, points=[point])
    resp = SwapsResponse(status=SourceStatus.OK, file_date=1_700_000_000_000, curves=[curve])
    body = resp.model_dump(by_alias=True)
    assert body["fileDate"] == 1_700_000_000_000
    assert body["curves"][0]["key"] == "sofr"
    assert body["curves"][0]["points"][0]["tenorLabel"] == "10Y"


from app.adapters.sdr import (
    classify_underlier,
    parse_notional,
    pick_fixed_rate,
    tenor_years,
    bucket_tenor,
    aggregate,
    parse_rates_csv,
)

# Minimal fixture: only the columns the parser reads (real files have 110).
FIXTURE_CSV = (
    "Action type,Asset Class,Effective Date,Expiration Date,"
    "Fixed rate-Leg 1,Fixed rate-Leg 2,Notional amount-Leg 1,Notional amount-Leg 2,"
    "UPI Underlier Name\n"
    # SOFR 10Y, rate on leg 2
    "NEWT,IR,2025-06-02,2035-06-02,,0.0396408,25000000,,USD-SOFR-OIS Compound\n"
    # SOFR ~10Y, rate on leg 1 (different spelling -> still SOFR)
    "NEWT,IR,2025-06-02,2035-06-01,0.0400000,,50000000,,USD-SOFR-COMPOUND\n"
    # US CPI 1Y
    "NEWT,IR,2025-05-21,2026-05-21,0.03235,,93000000,,USA-CPI-U\n"
    # SOFR 5Y with a CAPPED notional
    "NEWT,IR,2025-06-02,2030-06-02,,0.038,250000000+,,USD-SOFR-OIS Compound\n"
    # basis ' vs ' -> EXCLUDED
    "NEWT,IR,2025-06-02,2035-06-02,,0.01,10000000,,EUR-EURIBOR vs USD-SOFR-OIS Compound\n"
    # non-USD inflation -> EXCLUDED
    "NEWT,IR,2025-05-21,2026-05-21,0.02,,1000000,,EUR-EXT-CPI\n"
    # MODI action -> EXCLUDED
    "MODI,IR,2025-06-02,2035-06-02,,0.05,10000000,,USD-SOFR-OIS Compound\n"
)


def test_classify_underlier():
    assert classify_underlier("USD-SOFR-OIS Compound") == "sofr"
    assert classify_underlier("usd-sofr-compound") == "sofr"
    assert classify_underlier("USA-CPI-U") == "cpi"
    assert classify_underlier("EUR-EURIBOR vs USD-SOFR-OIS Compound") is None  # basis
    assert classify_underlier("EUR-EXT-CPI") is None
    assert classify_underlier("") is None


def test_parse_notional():
    assert parse_notional("25,000,000") == (25_000_000.0, False)
    assert parse_notional("250,000,000+") == (250_000_000.0, True)
    assert parse_notional("") == (0.0, False)
    assert parse_notional("n/a") == (0.0, False)


def test_pick_fixed_rate_prefers_populated_leg_and_converts_to_percent():
    assert pick_fixed_rate({"Fixed rate-Leg 1": "", "Fixed rate-Leg 2": "0.0396408"}) == pytest.approx(3.96408)
    assert pick_fixed_rate({"Fixed rate-Leg 1": "0.04", "Fixed rate-Leg 2": ""}) == pytest.approx(4.0)
    assert pick_fixed_rate({"Fixed rate-Leg 1": "", "Fixed rate-Leg 2": ""}) is None


def test_tenor_years():
    assert tenor_years("2025-06-02", "2035-06-02") == pytest.approx(9.9986, abs=1e-3)
    assert tenor_years("2025-05-21", "2026-05-21") == pytest.approx(0.9993, abs=1e-3)
    assert tenor_years("2035-06-02", "2025-06-02") is None  # reversed
    assert tenor_years("", "2035-06-02") is None


def test_bucket_tenor():
    assert bucket_tenor(9.9986) == ("10Y", 10.0)
    assert bucket_tenor(4.999) == ("5Y", 5.0)
    assert bucket_tenor(0.9993) == ("1Y", 1.0)
    assert bucket_tenor(4.0) is None  # between 3Y and 5Y, outside tolerance


def test_aggregate_medians_per_tenor_sorted_by_years():
    samples = [
        ("10Y", 10.0, 3.96408, 25_000_000.0),
        ("10Y", 10.0, 4.0, 50_000_000.0),
        ("5Y", 5.0, 3.8, 250_000_000.0),
    ]
    points = aggregate(samples)
    assert [p.tenor_label for p in points] == ["5Y", "10Y"]  # sorted by tenor_years
    ten = points[1]
    assert ten.trade_count == 2
    assert ten.rate_pct == pytest.approx(3.98204)
    assert ten.total_notional == 75_000_000.0


def test_parse_rates_csv_filters_classifies_and_aggregates():
    curves = parse_rates_csv(FIXTURE_CSV, 1_700_000_000_000)
    by_key = {c.key: c for c in curves}
    assert set(by_key) == {"sofr", "cpi"}

    sofr = by_key["sofr"]
    assert sofr.obs_date == 1_700_000_000_000
    assert [p.tenor_label for p in sofr.points] == ["5Y", "10Y"]
    ten = next(p for p in sofr.points if p.tenor_label == "10Y")
    assert ten.trade_count == 2
    assert ten.rate_pct == pytest.approx(3.98204)
    assert ten.total_notional == 75_000_000.0
    five = next(p for p in sofr.points if p.tenor_label == "5Y")
    assert five.total_notional == 250_000_000.0  # capped value counted

    cpi = by_key["cpi"]
    assert [p.tenor_label for p in cpi.points] == ["1Y"]
    assert cpi.points[0].rate_pct == pytest.approx(3.235)


from app.adapters.sdr import SdrAdapter
from app.adapters.base import SourceUnavailable
from app.cache import cache
import io
import zipfile


def test_get_swap_rates_walks_back_to_first_available(monkeypatch):
    cache._store.clear()
    today = datetime.now(timezone.utc).date()
    available = today - timedelta(days=1)  # today's file 404s; yesterday's exists

    async def fake_fetch(self, d):
        if d == available:
            return FIXTURE_CSV
        raise SourceUnavailable("sdr error (HTTP 404)")

    monkeypatch.setattr(SdrAdapter, "_fetch_csv", fake_fetch)

    curves = asyncio.run(SdrAdapter().get_swap_rates())
    by_key = {c.key: c for c in curves}
    assert set(by_key) == {"sofr", "cpi"}
    sofr = by_key["sofr"]
    assert [p.tenor_label for p in sofr.points] == ["5Y", "10Y"]
    expected_ms = int(
        datetime(available.year, available.month, available.day, tzinfo=timezone.utc).timestamp() * 1000
    )
    assert sofr.obs_date == expected_ms


def test_get_swap_rates_raises_when_no_file_in_window(monkeypatch):
    cache._store.clear()

    async def fake_fetch(self, d):
        raise SourceUnavailable("sdr error (HTTP 404)")

    monkeypatch.setattr(SdrAdapter, "_fetch_csv", fake_fetch)
    with pytest.raises(SourceUnavailable):
        asyncio.run(SdrAdapter().get_swap_rates())


def test_fetch_csv_unzips_in_memory(monkeypatch):
    cache._store.clear()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("CFTC_CUMULATIVE_RATES_2025_05_29.csv", FIXTURE_CSV)
    zip_bytes = buf.getvalue()

    async def fake_get_bytes(url, *, source, **kwargs):
        assert source == "sdr"
        assert url.endswith("CFTC_CUMULATIVE_RATES_2025_05_29.zip")
        return zip_bytes

    monkeypatch.setattr("app.adapters.sdr.get_bytes", fake_get_bytes)
    text = asyncio.run(SdrAdapter()._fetch_csv(date(2025, 5, 29)))
    assert "USD-SOFR-OIS Compound" in text

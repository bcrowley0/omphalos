"""Unit tests for FRED normalization (pure functions, no network)."""

import asyncio
from datetime import date

from app.adapters.fred import (
    fred_date_to_ms,
    parse_observations,
    latest_on_or_before,
    relative_target,
    resolve_as_of,
    FredAdapter,
)
from app.models import AsOfCurve, YieldPoint, YieldCurveResponse, SourceStatus
from app.routers import parse_asof_dates


def test_parse_asof_dates_valid_and_invalid():
    dates, error = parse_asof_dates(["2024-06-06", "2024-01-15"])
    assert error is None
    assert [d.isoformat() for d in dates] == ["2024-06-06", "2024-01-15"]

    dates, error = parse_asof_dates(["not-a-date"])
    assert dates == []
    assert error is not None and "not-a-date" in error


def test_fred_date_to_ms_is_utc_midnight():
    # 2024-06-07 UTC midnight = 1717718400 s
    assert fred_date_to_ms("2024-06-07") == 1717718400 * 1000


def test_asofcurve_serializes_camelcase():
    c = AsOfCurve(
        key="1w",
        label="1W ago",
        requested_date=1717718400000,
        obs_date=1717632000000,
        points=[YieldPoint(tenor_label="10Y", tenor_years=10.0, rate_pct=4.43, obs_date=1717632000000)],
    )
    dumped = c.model_dump(by_alias=True)
    assert dumped["requestedDate"] == 1717718400000
    assert dumped["obsDate"] == 1717632000000
    assert dumped["points"][0]["tenorLabel"] == "10Y"


def test_yieldcurveresponse_holds_curves():
    r = YieldCurveResponse(status=SourceStatus.OK, curves=[])
    assert r.model_dump(by_alias=True)["curves"] == []
    assert not hasattr(r, "points")


def test_parse_observations_sorts_ascending_and_drops_dots():
    payload = {
        "observations": [
            {"date": "2024-06-07", "value": "4.43"},
            {"date": "2024-06-10", "value": "."},      # dropped
            {"date": "2024-06-06", "value": "4.40"},
        ]
    }
    series = parse_observations(payload)
    assert series == [
        (fred_date_to_ms("2024-06-06"), 4.40),
        (fred_date_to_ms("2024-06-07"), 4.43),
    ]


def test_latest_on_or_before_picks_latest_not_after_target():
    series = [
        (fred_date_to_ms("2024-06-03"), 4.30),
        (fred_date_to_ms("2024-06-05"), 4.35),
        (fred_date_to_ms("2024-06-07"), 4.43),
    ]
    # Target is a weekend (06-08) -> latest on/before is Friday 06-07
    assert latest_on_or_before(series, fred_date_to_ms("2024-06-08")) == (
        fred_date_to_ms("2024-06-07"),
        4.43,
    )
    # Exact hit
    assert latest_on_or_before(series, fred_date_to_ms("2024-06-05")) == (
        fred_date_to_ms("2024-06-05"),
        4.35,
    )
    # Before the series start -> None
    assert latest_on_or_before(series, fred_date_to_ms("2024-06-01")) is None


def test_relative_target_day_week_month_year():
    cur = fred_date_to_ms("2024-06-07")
    assert relative_target(cur, "1d") == fred_date_to_ms("2024-06-06")
    assert relative_target(cur, "1w") == fred_date_to_ms("2024-05-31")
    assert relative_target(cur, "1m") == fred_date_to_ms("2024-05-07")
    assert relative_target(cur, "3m") == fred_date_to_ms("2024-03-07")
    assert relative_target(cur, "1y") == fred_date_to_ms("2023-06-07")


def test_relative_target_clamps_short_month():
    # 2024-03-31 minus 1 month -> Feb has no 31st -> clamp to 2024-02-29
    cur = fred_date_to_ms("2024-03-31")
    assert relative_target(cur, "1m") == fred_date_to_ms("2024-02-29")


def _fake_history():
    # Two tenors with a few business days; 10Y has a gap on the latest day.
    return {
        "DGS1MO": [
            (fred_date_to_ms("2024-06-03"), 5.30),
            (fred_date_to_ms("2024-06-07"), 5.32),
        ],
        "DGS10": [
            (fred_date_to_ms("2024-06-03"), 4.40),
            (fred_date_to_ms("2024-06-06"), 4.43),  # no 06-07 obs for 10Y
        ],
    }


def test_resolve_as_of_aligns_by_tenor_and_uses_on_or_before():
    points = resolve_as_of(_fake_history(), fred_date_to_ms("2024-06-07"))
    by_label = {p.tenor_label: p for p in points}
    assert by_label["1M"].rate_pct == 5.32
    assert by_label["1M"].obs_date == fred_date_to_ms("2024-06-07")
    # 10Y has no 06-07 obs -> latest on/before is 06-06
    assert by_label["10Y"].rate_pct == 4.43
    assert by_label["10Y"].obs_date == fred_date_to_ms("2024-06-06")


def test_resolve_as_of_omits_tenor_with_no_data_in_range():
    points = resolve_as_of(_fake_history(), fred_date_to_ms("2024-06-01"))
    assert points == []  # target precedes every observation


def test_get_yield_curve_builds_current_and_presets(monkeypatch):
    adapter = FredAdapter()
    # Stub the network/cache layer: feed a fixed history.
    async def fake_history(self, start_ms):  # noqa: ARG001
        return _fake_history()

    monkeypatch.setattr(FredAdapter, "_history", fake_history)
    monkeypatch.setattr(FredAdapter, "_api_key", lambda self: "test-key")

    curves = asyncio.run(adapter.get_yield_curve([]))
    keys = [c.key for c in curves]
    assert keys[0] == "current"
    assert keys[1:] == ["1d", "1w", "1m", "3m", "6m", "1y"]
    current = curves[0]
    assert current.label == "Today"
    # current uses the latest available date across series (2024-06-07)
    assert current.requested_date == fred_date_to_ms("2024-06-07")
    assert {p.tenor_label for p in current.points} == {"1M", "10Y"}


def test_get_yield_curve_appends_exact_dates(monkeypatch):
    adapter = FredAdapter()

    async def fake_history(self, start_ms):  # noqa: ARG001
        return _fake_history()

    monkeypatch.setattr(FredAdapter, "_history", fake_history)
    monkeypatch.setattr(FredAdapter, "_api_key", lambda self: "test-key")

    curves = asyncio.run(adapter.get_yield_curve([date(2024, 6, 6)]))
    exact = curves[-1]
    assert exact.key == "2024-06-06"
    assert exact.requested_date == fred_date_to_ms("2024-06-06")
    by_label = {p.tenor_label: p for p in exact.points}
    assert by_label["10Y"].rate_pct == 4.43

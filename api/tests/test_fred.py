"""Unit tests for FRED normalization (pure functions, no network)."""

from app.adapters.fred import fred_date_to_ms, latest_valid_observation
from app.models import AsOfCurve, YieldPoint, YieldCurveResponse, SourceStatus


def test_fred_date_to_ms_is_utc_midnight():
    # 2024-06-07 UTC midnight = 1717718400 s
    assert fred_date_to_ms("2024-06-07") == 1717718400 * 1000


def test_latest_valid_observation_skips_missing_dots():
    payload = {
        "observations": [
            {"date": "2024-06-09", "value": "."},  # holiday/missing -> skip
            {"date": "2024-06-07", "value": "4.43"},
            {"date": "2024-06-06", "value": "4.40"},
        ]
    }
    rate, obs_ms = latest_valid_observation(payload)
    assert rate == 4.43
    assert obs_ms == fred_date_to_ms("2024-06-07")


def test_latest_valid_observation_none_when_all_missing():
    assert latest_valid_observation({"observations": [{"date": "2024-06-09", "value": "."}]}) is None
    assert latest_valid_observation({"observations": []}) is None


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

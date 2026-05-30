"""Unit tests for FRED normalization (pure functions, no network)."""

from app.adapters.fred import fred_date_to_ms, latest_valid_observation


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

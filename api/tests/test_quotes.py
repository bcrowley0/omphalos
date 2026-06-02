from app.models import PeriodChange, Quote, QuoteResponse, SourceStatus


def test_quote_has_optional_day_stats_defaulting_none():
    q = Quote(symbol="AAPL", source="ibkr")
    assert q.day_open is None
    assert q.day_high is None
    assert q.day_low is None
    assert q.volume is None
    assert q.vwap is None
    assert q.week52_high is None
    assert q.week52_low is None
    assert q.market_cap is None


def test_quote_serializes_new_fields_as_camel_case():
    q = Quote(symbol="AAPL", source="ibkr", day_open=1.0, week52_high=2.0, market_cap=3.0)
    dumped = q.model_dump(by_alias=True)
    assert dumped["dayOpen"] == 1.0
    assert dumped["week52High"] == 2.0
    assert dumped["marketCap"] == 3.0


def test_period_change_model():
    pc = PeriodChange(period="1M", change=1.5, change_pct=2.0, ref_close=75.0)
    assert pc.model_dump(by_alias=True) == {
        "period": "1M",
        "change": 1.5,
        "changePct": 2.0,
        "refClose": 75.0,
    }


def test_quote_response_period_defaults():
    resp = QuoteResponse(status=SourceStatus.OK)
    assert resp.period_changes == []
    assert resp.period_status == SourceStatus.OK

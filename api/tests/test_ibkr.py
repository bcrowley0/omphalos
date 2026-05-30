"""Unit tests for IBKR pure helpers (no gateway needed)."""

from app.adapters.ibkr import parse_position, parse_snapshot, pick_primary_conid


def test_pick_primary_conid_prefers_us_stk_listing():
    results = [
        {"conid": 111, "description": "MEXI", "sections": [{"secType": "STK"}]},
        {"conid": 265598, "description": "NASDAQ", "sections": [{"secType": "STK"}]},
        {"conid": 999, "description": "LSE", "sections": [{"secType": "OPT"}]},
    ]
    assert pick_primary_conid(results, "AAPL") == "265598"


def test_pick_primary_conid_falls_back_to_first_stk():
    results = [
        {"conid": 5, "description": "OPT-ONLY", "sections": [{"secType": "OPT"}]},
        {"conid": 7, "description": "SOMEEXCH", "sections": [{"secType": "STK"}]},
    ]
    assert pick_primary_conid(results, "X") == "7"


def test_pick_primary_conid_none_when_empty():
    assert pick_primary_conid([], "X") is None


def test_parse_snapshot_maps_field_codes():
    row = {"31": "241.17", "84": "241.05", "86": "241.29", "82": "-4.97", "83": "-2.02", "_updated": 1700000000000}
    q = parse_snapshot(row, "AAPL")
    assert q.symbol == "AAPL"
    assert q.last == 241.17
    assert q.bid == 241.05
    assert q.ask == 241.29
    assert q.change == -4.97
    assert q.change_pct == -2.02
    assert q.stale is False
    assert q.source == "ibkr"


def test_parse_snapshot_marks_stale_when_last_missing_or_prefixed():
    # missing last -> stale, missing fields tolerated (None)
    q = parse_snapshot({"84": "10.0"}, "AAPL")
    assert q.stale is True
    assert q.last is None
    assert q.bid == 10.0
    # delayed/prior prefixed value ('C123.4') -> numeric extracted, stale True
    q2 = parse_snapshot({"31": "C123.45"}, "AAPL")
    assert q2.last == 123.45
    assert q2.stale is True


def test_parse_position_normalizes():
    p = {"conid": 265598, "ticker": "AAPL", "position": 50, "avgCost": 150.0, "mktValue": 12058.5, "unrealizedPnl": 4558.5}
    pos = parse_position(p)
    assert pos.symbol == "AAPL"
    assert pos.qty == 50.0
    assert pos.avg_cost == 150.0
    assert pos.market_value == 12058.5
    assert pos.unrealized_pnl == 4558.5
    assert pos.source == "ibkr"

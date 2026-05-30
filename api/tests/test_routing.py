from app.routing import source_for_symbol


def test_pairs_route_to_kraken():
    assert source_for_symbol("BTC/USD") == "kraken"
    assert source_for_symbol("ETH/EUR") == "kraken"


def test_plain_tickers_route_to_ibkr():
    assert source_for_symbol("AAPL") == "ibkr"
    assert source_for_symbol("MSFT") == "ibkr"

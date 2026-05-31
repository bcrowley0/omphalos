from app.symbols import Resolved, resolve


def test_bare_crypto_base_defaults_to_usd_on_kraken():
    assert resolve("btc") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")


def test_explicit_pair_routes_to_kraken():
    assert resolve("BTC/USD") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")
    assert resolve("eth/eur") == Resolved(source="kraken", display="ETH/EUR", symbol="ETH/EUR")


def test_glued_crypto_form_is_split():
    assert resolve("btcusd") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")


def test_usdt_suffix_beats_usd():
    # ETHUSDT must split as ETH + USDT, not ETHUS + DT or ETHUSD + T.
    assert resolve("ethusdt") == Resolved(source="kraken", display="ETH/USDT", symbol="ETH/USDT")


def test_kraken_legacy_base_alias_accepted_as_input():
    assert resolve("xbt") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")
    assert resolve("xbtusd") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")


def test_plain_equity_ticker_routes_to_ibkr():
    assert resolve("aapl") == Resolved(source="ibkr", display="AAPL", symbol="AAPL")
    assert resolve("MSFT") == Resolved(source="ibkr", display="MSFT", symbol="MSFT")


def test_bare_quote_currency_falls_through_to_ibkr():
    # "usd" is not a crypto base and has no crypto prefix -> not rerouted to Kraken.
    assert resolve("usd").source == "ibkr"


def test_unknown_base_with_slash_still_routes_to_kraken():
    assert resolve("FOO/USD") == Resolved(source="kraken", display="FOO/USD", symbol="FOO/USD")


def test_whitespace_is_tolerated():
    assert resolve("  btc/usd  ") == Resolved(source="kraken", display="BTC/USD", symbol="BTC/USD")

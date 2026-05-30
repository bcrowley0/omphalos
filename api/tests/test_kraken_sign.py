"""Verify the Kraken API-Sign against Kraken's OWN published example.

Source: Kraken REST API auth docs ("Example API-Sign"). If this passes, the
HMAC-SHA512 construction (path + SHA256(nonce+postdata), base64 secret/result)
matches Kraken byte-for-byte.
"""

from app.adapters.kraken import normalize_asset, parse_balances, sign_request


def test_sign_matches_kraken_published_vector():
    secret = "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg=="
    path = "/0/private/AddOrder"
    data = {
        "nonce": "1616492376594",
        "ordertype": "limit",
        "pair": "XBTUSD",
        "price": "37500",
        "type": "buy",
        "volume": "1.25",
    }
    expected = "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ=="
    assert sign_request(path, data, secret) == expected


def test_normalize_asset():
    assert normalize_asset("ZUSD") == "USD"
    assert normalize_asset("XXBT") == "BTC"
    assert normalize_asset("XETH") == "ETH"
    assert normalize_asset("USDT") == "USDT"  # 4 chars but not X/Z prefixed legacy


def test_parse_balances_uses_balance_minus_hold_and_drops_zero():
    payload = {
        "error": [],
        "result": {
            "ZUSD": {"balance": "12500.0000", "hold_trade": "500.0000"},
            "XXBT": {"balance": "0.7500", "hold_trade": "0.0"},
            "XETH": {"balance": "0.0", "hold_trade": "0.0"},  # dropped
        },
    }
    bals = {b.asset: b for b in parse_balances(payload)}
    assert set(bals) == {"USD", "BTC"}
    assert bals["USD"].total == 12500.0
    assert bals["USD"].available == 12000.0
    assert bals["BTC"].available == 0.75

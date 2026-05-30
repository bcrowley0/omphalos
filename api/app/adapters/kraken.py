"""Kraken adapter — spot, read-only (see .claude/rules/kraken.md).

Phase 2: public Ticker + OHLC (no auth). Phase 3 adds signed private balances.
All timestamps normalized epoch-seconds -> epoch-MILLISECONDS at this boundary.
"""

from __future__ import annotations

from typing import Any

from ..cache import cache
from ..http import get_json
from ..models import Candle, Quote
from .base import Adapter, SourceUnavailable

_PUBLIC_BASE = "https://api.kraken.com/0/public"
_TICKER_TTL = 15.0
_OHLC_TTL = 30.0

# Kraken uses non-standard asset codes for a few bases (e.g. BTC -> XBT).
_BASE_ALIASES = {"BTC": "XBT", "DOGE": "XDG"}

# CLAUDE.md interval label -> Kraken OHLC interval in minutes.
_INTERVAL_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080}


def krakenize_pair(pair: str) -> str:
    """`BTC/USD` -> `XBTUSD` (Kraken altname). Pure/testable."""
    base, _, quote = pair.upper().partition("/")
    base = _BASE_ALIASES.get(base, base)
    return f"{base}{quote}"


def _check_error(payload: dict[str, Any], source: str) -> None:
    errors = payload.get("error") or []
    if not errors:
        return
    joined = "; ".join(errors)
    if "rate limit" in joined.lower():
        from .base import RateLimited

        raise RateLimited(f"kraken: {joined}")
    raise SourceUnavailable(f"kraken: {joined}")


def _first_result(payload: dict[str, Any], *, skip: set[str] = frozenset()) -> Any:
    result = payload.get("result") or {}
    for key, value in result.items():
        if key in skip:
            continue
        return value
    raise SourceUnavailable("kraken: empty result")


def parse_ticker(payload: dict[str, Any], symbol: str) -> Quote:
    """Pure: Kraken Ticker payload -> canonical Quote."""
    _check_error(payload, "kraken")
    t = _first_result(payload)
    last = float(t["c"][0])
    bid = float(t["b"][0])
    ask = float(t["a"][0])
    open_ = float(t["o"]) if not isinstance(t["o"], list) else float(t["o"][0])
    change = round(last - open_, 8)
    change_pct = round((change / open_) * 100, 4) if open_ else 0.0
    return Quote(
        symbol=symbol,
        last=last,
        bid=bid,
        ask=ask,
        change=change,
        change_pct=change_pct,
        ts=None,
        stale=False,
        source="kraken",
    )


def parse_ohlc(payload: dict[str, Any]) -> list[Candle]:
    """Pure: Kraken OHLC payload -> canonical Candles (seconds -> ms)."""
    _check_error(payload, "kraken")
    rows = _first_result(payload, skip={"last"})
    candles: list[Candle] = []
    for row in rows:
        # [time(s), open, high, low, close, vwap, volume, count]
        candles.append(
            Candle(
                t=int(row[0]) * 1000,
                o=float(row[1]),
                h=float(row[2]),
                l=float(row[3]),
                c=float(row[4]),
                v=float(row[6]),
            )
        )
    return candles


class KrakenAdapter(Adapter):
    name = "kraken"

    async def get_quote(self, symbol: str) -> Quote:
        kp = krakenize_pair(symbol)

        async def fetch() -> dict[str, Any]:
            return await get_json(f"{_PUBLIC_BASE}/Ticker", source="kraken", params={"pair": kp})

        payload = await cache.get_or_set(f"kraken:ticker:{kp}", _TICKER_TTL, fetch)
        return parse_ticker(payload, symbol.upper())

    async def get_candles(self, symbol: str, interval: str = "1d") -> list[Candle]:
        kp = krakenize_pair(symbol)
        minutes = _INTERVAL_MINUTES.get(interval, 1440)

        async def fetch() -> dict[str, Any]:
            return await get_json(
                f"{_PUBLIC_BASE}/OHLC", source="kraken", params={"pair": kp, "interval": minutes}
            )

        payload = await cache.get_or_set(f"kraken:ohlc:{kp}:{minutes}", _OHLC_TTL, fetch)
        return parse_ohlc(payload)

    # get_balances (private, signed) added in Phase 3.

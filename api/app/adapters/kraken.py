"""Kraken adapter — spot, read-only (see .claude/rules/kraken.md).

Phase 2: public Ticker + OHLC (no auth). Phase 3 adds signed private balances.
All timestamps normalized epoch-seconds -> epoch-MILLISECONDS at this boundary.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import threading
import time
import urllib.parse
from collections.abc import Set as AbstractSet
from typing import Any

from ..cache import cache
from ..config import get_settings
from ..http import get_json, post_form
from ..models import Balance, Candle, Interval, INTERVAL_MS, Quote, Span, SPAN_MS
from .base import Adapter, RateLimited, SourceUnavailable, Unauthenticated

_API_ROOT = "https://api.kraken.com"
_PUBLIC_BASE = f"{_API_ROOT}/0/public"
_TICKER_TTL = 15.0
_OHLC_TTL = 30.0

# Kraken uses non-standard asset codes for a few bases (e.g. BTC -> XBT).
_BASE_ALIASES = {"BTC": "XBT", "DOGE": "XDG"}


def sign_request(path: str, data: dict[str, Any], b64_secret: str) -> str:
    """Kraken API-Sign, EXACTLY per Kraken's auth docs (verified against their
    published test vector in tests/test_kraken_sign.py):

      HMAC-SHA512 over [ URI_path_bytes + SHA256(nonce + POST_data) ],
      keyed by the base64-DECODED private key, output base64-ENCODED.

    Pure/testable.
    """
    postdata = urllib.parse.urlencode(data)
    encoded = (str(data["nonce"]) + postdata).encode()
    message = path.encode() + hashlib.sha256(encoded).digest()
    mac = hmac.new(base64.b64decode(b64_secret), message, hashlib.sha512)
    return base64.b64encode(mac.digest()).decode()


# Kraken legacy asset codes -> canonical. Z* are fiat, X* are crypto (4-char).
_ASSET_ALIASES = {"XBT": "BTC", "XDG": "DOGE"}


def normalize_asset(code: str) -> str:
    """`ZUSD`->`USD`, `XXBT`->`BTC`, `XETH`->`ETH`, `USDT`->`USDT`. Pure/testable."""
    c = code
    if len(c) == 4 and c[0] in ("X", "Z"):
        c = c[1:]
    return _ASSET_ALIASES.get(c, c)


class _NonceFactory:
    """Strictly-increasing nonce per process (CLAUDE.md: monotonic, collision-safe)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last = 0

    def next(self) -> int:
        with self._lock:
            candidate = int(time.time() * 1000)
            if candidate <= self._last:
                candidate = self._last + 1
            self._last = candidate
            return candidate


_nonce = _NonceFactory()


def parse_balances(payload: dict[str, Any]) -> list[Balance]:
    """Pure: Kraken BalanceEx payload -> canonical Balances.

    BalanceEx result: { asset: {balance, hold_trade}, ... }. available =
    balance - hold_trade. Zero-balance assets are dropped.
    """
    result = payload.get("result") or {}
    out: list[Balance] = []
    for code, info in result.items():
        total = float(info.get("balance", 0) or 0)
        hold = float(info.get("hold_trade", 0) or 0)
        if total == 0 and hold == 0:
            continue
        out.append(
            Balance(
                asset=normalize_asset(code),
                total=total,
                available=max(0.0, total - hold),
                source="kraken",
            )
        )
    return out


def krakenize_pair(pair: str) -> str:
    """`BTC/USD` -> `XBTUSD` (Kraken altname). Pure/testable."""
    base, _, quote = pair.upper().partition("/")
    base = _BASE_ALIASES.get(base, base)
    return f"{base}{quote}"


def kraken_ohlc_params(interval: Interval, span: Span, now_ms: int) -> tuple[int, int]:
    """Map canonical (interval, span) to Kraken OHLC params.

    Returns (interval_minutes, since_seconds). `since` is epoch SECONDS (Kraken's
    unit) aligned down to the bar boundary so the cache key stays stable within a
    bar (avoids a fresh fetch every call). Pure/testable.

    NOTE: Kraken's OHLC endpoint returns at most 720 candles and silently
    truncates beyond that. Callers must keep (span / interval) <= 720 bars so the
    full requested window is returned; the frontend `resolveRange` valid-interval
    map enforces this for every UI-offered pair.
    """
    minutes = INTERVAL_MS[interval] // 60_000
    since_s = (now_ms - SPAN_MS[span]) // 1000
    bar_s = minutes * 60
    since_s -= since_s % bar_s
    return minutes, since_s


def _check_error(payload: dict[str, Any]) -> None:
    errors = payload.get("error") or []
    if not errors:
        return
    joined = "; ".join(errors)
    if "rate limit" in joined.lower():
        raise RateLimited(f"kraken: {joined}")
    raise SourceUnavailable(f"kraken: {joined}")


def _first_result(payload: dict[str, Any], *, skip: AbstractSet[str] = frozenset()) -> Any:
    result = payload.get("result") or {}
    for key, value in result.items():
        if key in skip:
            continue
        return value
    raise SourceUnavailable("kraken: empty result")


def parse_ticker(payload: dict[str, Any], symbol: str) -> Quote:
    """Pure: Kraken Ticker payload -> canonical Quote."""
    _check_error(payload)
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
    _check_error(payload)
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

    async def get_candles(
        self, symbol: str, interval: Interval = Interval.D1, span: Span = Span.M1
    ) -> list[Candle]:
        kp = krakenize_pair(symbol)
        minutes, since = kraken_ohlc_params(interval, span, int(time.time() * 1000))

        async def fetch() -> dict[str, Any]:
            return await get_json(
                f"{_PUBLIC_BASE}/OHLC",
                source="kraken",
                params={"pair": kp, "interval": minutes, "since": since},
            )

        payload = await cache.get_or_set(f"kraken:ohlc:{kp}:{minutes}:{since}", _OHLC_TTL, fetch)
        return parse_ohlc(payload)

    # -- private (signed) -------------------------------------------------- #
    async def get_balances(self) -> list[Balance]:
        settings = get_settings()
        key, secret = settings.kraken_api_key, settings.kraken_api_secret
        if not key or not secret:
            raise Unauthenticated("Kraken API key/secret not set in api/.env")

        path = "/0/private/BalanceEx"
        data = {"nonce": _nonce.next()}
        try:
            api_sign = sign_request(path, data, secret)
        except (ValueError, binascii.Error) as exc:  # malformed secret
            raise Unauthenticated("Kraken API secret is not valid base64") from exc

        # Signed POST with a per-call nonce — never cached (a nonce is single-use).
        payload = await post_form(
            f"{_API_ROOT}{path}",
            source="kraken",
            data=data,
            headers={"API-Key": key, "API-Sign": api_sign},
        )
        self._raise_for_private_error(payload)
        return parse_balances(payload)

    @staticmethod
    def _raise_for_private_error(payload: dict[str, Any]) -> None:
        errors = payload.get("error") or []
        if not errors:
            return
        joined = "; ".join(errors).lower()
        if "rate limit" in joined:
            raise RateLimited(f"kraken: {'; '.join(payload['error'])}")
        if "invalid key" in joined or "permission denied" in joined or "invalid signature" in joined:
            raise Unauthenticated(f"kraken: {'; '.join(payload['error'])}")
        raise SourceUnavailable(f"kraken: {'; '.join(payload['error'])}")

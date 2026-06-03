"""IBKR — Client Portal Web API via the local CP Gateway, read-only
(see .claude/rules/ibkr.md).

Stateful and the hardest integration. The user runs IBKR's Client Portal Gateway
locally and logs in through the browser; this adapter calls the gateway's local
REST base. The gateway uses a self-signed cert, so its httpx client disables TLS
verification — for THIS localhost gateway client ONLY, never globally.

Snapshot field codes are numeric and taken from IBKR's official Web API reference
(verified, not guessed):
    31=Last, 84=Bid, 86=Ask, 82=Change, 83=Change%, 87=Volume, 7295=Open, 7296=Close,
    70=High, 71=Low, 7293=52WkHigh, 7294=52WkLow, 7289=MarketCap
VWAP has no documented snapshot field code and is intentionally unmapped.
"""

from __future__ import annotations

import asyncio
import re
import urllib.parse
from typing import Any

import httpx

from ..config import get_settings
from ..http import get_json, post_form
from ..models import Candle, IbkrAuthState, Interval, Position, Quote, Span
from .base import Adapter, SourceUnavailable, Unauthenticated

# Numeric snapshot field codes -> canonical names (IBKR Web API reference).
# Verified against IBKR Client Portal Web API spec (IB-client-web-API-spec):
#   31=Last, 84=Bid, 86=Ask, 82=Change, 83=Change%, 87=Volume,
#   7295=Open, 7296=Close, 70=High, 71=Low,
#   7293=52WkHigh, 7294=52WkLow, 7289=MarketCap
# VWAP has no documented snapshot field code — intentionally unmapped.
_FIELDS: dict[str, str] = {
    "31": "last",
    "84": "bid",
    "86": "ask",
    "82": "change",
    "83": "change_pct",
    "87": "volume",
    "7295": "open",
    "7296": "close",
    "70": "day_high",
    "71": "day_low",
    "7293": "week52_high",
    "7294": "week52_low",
    "7289": "market_cap",
}

_US_PRIMARY = ("NASDAQ", "NYSE", "ARCA", "BATS", "AMEX")
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _num(value: Any) -> float | None:
    """Parse an IBKR numeric field that may be a string with prefixes/commas
    (e.g. 'C241.17' for a delayed/prior value, '1,234.5'). None if unparseable.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = _NUM_RE.search(str(value).replace(",", ""))
    return float(m.group()) if m else None


def gateway_login_url(base_url: str) -> str:
    """Origin (scheme://host[:port]) of the gateway base URL — the page the user
    logs in at. Strips the '/v1/api' path so config stays the single source of
    truth for the gateway location. Pure/testable.
    """
    parts = urllib.parse.urlsplit(base_url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def pick_primary_conid(results: list[dict[str, Any]]) -> str | None:
    """Deterministic disambiguation among /iserver/secdef/search results.

    Rule (documented): prefer a contract exposing a STK section; among those
    prefer a US primary listing (NASDAQ/NYSE/ARCA/...); else the first STK; else
    the first result overall. Pure/testable.
    """
    if not results:
        return None

    def has_stk(item: dict[str, Any]) -> bool:
        return any((s.get("secType") == "STK") for s in item.get("sections", []))

    stk = [r for r in results if has_stk(r)]
    pool = stk or results
    for r in pool:
        desc = (r.get("description") or "").upper()
        if any(ex in desc for ex in _US_PRIMARY):
            return str(r["conid"])
    return str(pool[0]["conid"])


def parse_snapshot(row: dict[str, Any], symbol: str) -> Quote:
    """Pure: one snapshot row (field-code keys) -> canonical Quote.

    Marks stale=True when the live last price is absent or arrived with a
    non-numeric prefix (delayed/halted), and tolerates missing fields.
    """
    last_raw = row.get("31")
    stale = last_raw is None or (isinstance(last_raw, str) and bool(last_raw) and last_raw[0].isalpha())
    return Quote(
        symbol=symbol,
        last=_num(row.get("31")),
        bid=_num(row.get("84")),
        ask=_num(row.get("86")),
        change=_num(row.get("82")),
        change_pct=_num(row.get("83")),
        ts=int(row["_updated"]) if isinstance(row.get("_updated"), (int, float)) else None,
        stale=stale,
        source="ibkr",
        day_open=_num(row.get("7295")),
        day_high=_num(row.get("70")),
        day_low=_num(row.get("71")),
        volume=_num(row.get("87")),
        week52_high=_num(row.get("7293")),
        week52_low=_num(row.get("7294")),
        market_cap=_num(row.get("7289")),
    )


def parse_position(p: dict[str, Any]) -> Position:
    """Pure: one IBKR position row -> canonical Position."""
    symbol = p.get("ticker") or p.get("contractDesc") or str(p.get("conid", ""))
    return Position(
        symbol=symbol,
        qty=float(p.get("position", 0) or 0),
        avg_cost=float(p.get("avgCost", 0) or 0),
        market_value=float(p.get("mktValue", 0) or 0),
        unrealized_pnl=float(p.get("unrealizedPnl", 0) or 0),
        source="ibkr",
    )


_IBKR_BAR: dict[Interval, str] = {
    Interval.M1: "1min",
    Interval.M5: "5min",
    Interval.M15: "15min",
    Interval.H1: "1h",
    Interval.H4: "4h",
    Interval.D1: "1d",
    Interval.W1: "1w",
}

_IBKR_PERIOD: dict[Span, str] = {
    Span.D1: "1d",
    Span.D5: "5d",
    Span.M1: "1m",
    Span.M3: "3m",
    Span.Y1: "1y",
    Span.Y5: "5y",
}


def ibkr_bar(interval: Interval) -> str:
    """Canonical interval -> IBKR `bar` token. Pure/testable."""
    return _IBKR_BAR[interval]


def ibkr_period(span: Span) -> str:
    """Canonical span -> IBKR `period` token. Pure/testable."""
    return _IBKR_PERIOD[span]


def parse_history(payload: dict[str, Any]) -> list[Candle]:
    """Pure: /iserver/marketdata/history payload -> canonical Candles.

    IBKR `t` is already epoch milliseconds (unlike Kraken seconds) — do NOT scale.
    """
    rows = (payload or {}).get("data") or []
    candles: list[Candle] = []
    for r in rows:
        # Price fields are required; volume is absent on some IBKR instruments,
        # so it defaults to 0.
        candles.append(
            Candle(
                t=int(r["t"]),
                o=float(r["o"]),
                h=float(r["h"]),
                l=float(r["l"]),
                c=float(r["c"]),
                v=float(r.get("v") or 0),
            )
        )
    return candles


class IbkrAdapter(Adapter):
    name = "ibkr"

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._conids: dict[str, str] = {}
        self._primed = False

    def _gateway(self) -> httpx.AsyncClient:
        if self._client is None:
            base = get_settings().ibkr_gateway_base_url.rstrip("/")
            # TLS verification OFF for the localhost gateway ONLY (self-signed).
            self._client = httpx.AsyncClient(base_url=base, verify=False, timeout=httpx.Timeout(10.0, connect=4.0))
        return self._client

    async def _get(self, path: str, **kwargs: Any) -> Any:
        return await get_json(path, source="ibkr", client=self._gateway(), **kwargs)

    async def _post(self, path: str, **kwargs: Any) -> Any:
        return await post_form(path, source="ibkr", data={}, client=self._gateway(), **kwargs)

    async def _ensure_session(self) -> None:
        """Map the gateway state to the three required outcomes:
        unreachable -> SourceUnavailable; up-but-not-logged-in -> Unauthenticated;
        authenticated -> return. /tickle both keeps the session alive and reports
        auth status.
        """
        try:
            data = await self._post("/tickle")  # SourceUnavailable on connect error
        except Unauthenticated as exc:
            # An unauthenticated gateway answers /tickle with 401 (it proxies the
            # call upstream) — surface the actionable "log in" state, not a raw error.
            raise Unauthenticated(
                "Log in at the IBKR gateway in your browser, then retry."
            ) from exc
        except SourceUnavailable as exc:
            raise SourceUnavailable(
                "IBKR gateway is not reachable — is the Client Portal Gateway running?"
            ) from exc
        auth = (((data or {}).get("iserver") or {}).get("authStatus") or {}).get("authenticated")
        if auth is None:
            status = await self._get("/iserver/auth/status")
            auth = (status or {}).get("authenticated")
        if not auth:
            raise Unauthenticated("Log in at the IBKR gateway in your browser, then retry.")

    async def get_auth_state(self) -> IbkrAuthState:
        """Probe the gateway and return one of the three connection states without
        ever raising — backs the /ibkr/auth status endpoint (which has no error
        handling of its own, so a raise here would be an unhandled 500). Reuses
        _ensure_session's state machine: a not-logged-in gateway → "unauthenticated";
        any other failure (unreachable, rate-limited, or unexpected) → "unreachable".
        """
        try:
            await self._ensure_session()
        except Unauthenticated:
            return "unauthenticated"
        except Exception:  # noqa: BLE001 - status probe must never raise (CLAUDE.md rule #6)
            return "unreachable"
        return "authenticated"

    async def _prime(self) -> None:
        # Market data often requires the accounts endpoint to be hit first.
        if not self._primed:
            await self._get("/iserver/accounts")
            self._primed = True

    async def _resolve_conid(self, symbol: str) -> str:
        if symbol in self._conids:
            return self._conids[symbol]
        results = await self._get("/iserver/secdef/search", params={"symbol": symbol})
        conid = pick_primary_conid(results if isinstance(results, list) else [])
        if conid is None:
            raise SourceUnavailable(f"IBKR: no contract found for {symbol}")
        self._conids[symbol] = conid
        return conid

    async def get_quote(self, symbol: str) -> Quote:
        symbol = symbol.upper()
        await self._ensure_session()
        await self._prime()
        conid = await self._resolve_conid(symbol)
        fields = ",".join(_FIELDS)
        row: dict[str, Any] = {}
        # The FIRST snapshot request often returns empty -> re-request.
        for _ in range(3):
            data = await self._get(
                "/iserver/marketdata/snapshot", params={"conids": conid, "fields": fields}
            )
            if isinstance(data, list) and data:
                row = data[0]
                if any(code in row for code in ("31", "84", "86")):
                    break
            await asyncio.sleep(0.4)
        return parse_snapshot(row, symbol)

    async def get_positions(self) -> list[Position]:
        await self._ensure_session()
        accounts = await self._get("/portfolio/accounts")
        if not isinstance(accounts, list) or not accounts:
            raise SourceUnavailable("IBKR: no accounts returned")
        acct = accounts[0].get("accountId") or accounts[0].get("id")
        positions = await self._get(f"/portfolio/{acct}/positions/0")
        rows = positions if isinstance(positions, list) else []
        return [parse_position(p) for p in rows]

    async def get_candles(
        self, symbol: str, interval: Interval = Interval.D1, span: Span = Span.M1
    ) -> list[Candle]:
        symbol = symbol.upper()
        await self._ensure_session()
        await self._prime()
        conid = await self._resolve_conid(symbol)
        params = {"conid": conid, "period": ibkr_period(span), "bar": ibkr_bar(interval)}
        candles: list[Candle] = []
        # The first history request can return empty while the gateway warms up.
        for _ in range(3):
            data = await self._get("/iserver/marketdata/history", params=params)
            candles = parse_history(data if isinstance(data, dict) else {})
            if candles:
                break
            await asyncio.sleep(0.4)
        return candles

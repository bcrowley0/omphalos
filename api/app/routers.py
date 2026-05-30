"""Widget endpoints.

Each endpoint resolves an adapter from the registry, calls the canonical
operation, and maps any adapter exception to an explicit SourceStatus so the
frontend can render loading/source-down/unauth/rate-limited/empty without ever
seeing an unhandled crash (CLAUDE.md hard rule #6).
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query

from .adapters.base import (
    Adapter,
    NotSupported,
    RateLimited,
    SourceUnavailable,
    Unauthenticated,
)
from .deps import get_registry
from .models import (
    Balance,
    CalendarResponse,
    CandlesResponse,
    CryptoResponse,
    NewsResponse,
    PortfolioResponse,
    Position,
    Quote,
    QuoteResponse,
    SourceStatus,
    YieldCurveResponse,
)
from .routing import source_for_symbol

logger = logging.getLogger("omphalos.routers")

router = APIRouter()


def _adapter(name: str) -> Adapter | None:
    return get_registry().get(name)


def _status_from_exc(exc: Exception) -> tuple[SourceStatus, str]:
    """Map an adapter exception to a (status, message) pair."""
    if isinstance(exc, Unauthenticated):
        return SourceStatus.UNAUTHENTICATED, str(exc) or "Source requires authentication."
    if isinstance(exc, RateLimited):
        return SourceStatus.RATE_LIMITED, str(exc) or "Source rate limit hit; try again shortly."
    if isinstance(exc, SourceUnavailable):
        return SourceStatus.SOURCE_DOWN, str(exc) or "Source is unreachable."
    if isinstance(exc, NotSupported):
        return SourceStatus.NOT_IMPLEMENTED, str(exc)
    logger.exception("unexpected adapter error")
    return SourceStatus.SOURCE_DOWN, "Unexpected source error."


# --------------------------------------------------------------------------- #
# chart / quote (equities → IBKR; plain tickers only)
# --------------------------------------------------------------------------- #
@router.get("/chart/{symbol}", response_model=CandlesResponse, tags=["market"])
async def chart(symbol: str, interval: str = "1d") -> CandlesResponse:
    symbol = symbol.upper()
    source = source_for_symbol(symbol)
    adapter = _adapter(source)
    if adapter is None:
        return CandlesResponse(
            status=SourceStatus.SOURCE_DOWN,
            message=f"{source} integration not available.",
            symbol=symbol, source=source,
        )
    try:
        candles = await adapter.get_candles(symbol, interval=interval)
    except Exception as exc:  # noqa: BLE001 - mapped to a UI state, never crashes
        status, msg = _status_from_exc(exc)
        return CandlesResponse(status=status, message=msg, symbol=symbol, source=source)
    status = SourceStatus.OK if candles else SourceStatus.EMPTY
    return CandlesResponse(status=status, symbol=symbol, source=source, candles=candles)


@router.get("/quote/{symbol}", response_model=QuoteResponse, tags=["market"])
async def quote(symbol: str) -> QuoteResponse:
    symbol = symbol.upper()
    source = source_for_symbol(symbol)
    adapter = _adapter(source)
    if adapter is None:
        return QuoteResponse(status=SourceStatus.SOURCE_DOWN, message=f"{source} integration not available.")
    try:
        q: Quote = await adapter.get_quote(symbol)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return QuoteResponse(status=status, message=msg)
    return QuoteResponse(status=SourceStatus.OK, quote=q)


# --------------------------------------------------------------------------- #
# crypto (ticker + chart for a pair) → Kraken
# --------------------------------------------------------------------------- #
@router.get("/crypto/{base}/{quote_ccy}", response_model=CryptoResponse, tags=["market"])
async def crypto(base: str, quote_ccy: str) -> CryptoResponse:
    pair = f"{base.upper()}/{quote_ccy.upper()}"
    source = "kraken"
    adapter = _adapter(source)
    if adapter is None:
        return CryptoResponse(
            status=SourceStatus.SOURCE_DOWN, message="kraken integration not available.",
            pair=pair, source=source,
        )
    try:
        q, candles = await asyncio.gather(adapter.get_quote(pair), adapter.get_candles(pair))
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return CryptoResponse(status=status, message=msg, pair=pair, source=source)
    status = SourceStatus.OK if candles else SourceStatus.EMPTY
    return CryptoResponse(status=status, pair=pair, source=source, quote=q, candles=candles)


# --------------------------------------------------------------------------- #
# portfolio (positions from IBKR + balances from Kraken), each independent
# --------------------------------------------------------------------------- #
@router.get("/portfolio", response_model=PortfolioResponse, tags=["portfolio"])
async def portfolio() -> PortfolioResponse:
    positions: list[Position] = []
    balances: list[Balance] = []
    messages: list[str] = []

    ibkr = _adapter("ibkr")
    if ibkr is None:
        messages.append("IBKR not connected.")
    else:
        try:
            positions = await ibkr.get_positions()
        except Exception as exc:  # noqa: BLE001
            _, msg = _status_from_exc(exc)
            messages.append(f"positions: {msg}")

    kraken = _adapter("kraken")
    if kraken is not None:
        try:
            balances = await kraken.get_balances()
        except Exception as exc:  # noqa: BLE001
            _, msg = _status_from_exc(exc)
            messages.append(f"balances: {msg}")

    if positions or balances:
        status = SourceStatus.OK
    elif messages:
        status = SourceStatus.SOURCE_DOWN
    else:
        status = SourceStatus.EMPTY
    return PortfolioResponse(
        status=status,
        message="; ".join(messages) or None,
        positions=positions,
        balances=balances,
    )


# --------------------------------------------------------------------------- #
# yield curve → FRED
# --------------------------------------------------------------------------- #
@router.get("/yield", response_model=YieldCurveResponse, tags=["macro"])
async def yield_curve() -> YieldCurveResponse:
    adapter = _adapter("fred")
    if adapter is None:
        return YieldCurveResponse(status=SourceStatus.SOURCE_DOWN, message="fred integration not available.")
    try:
        points = await adapter.get_yield_curve()
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return YieldCurveResponse(status=status, message=msg)
    status = SourceStatus.OK if points else SourceStatus.EMPTY
    return YieldCurveResponse(status=status, points=points)


# --------------------------------------------------------------------------- #
# news → RSS (Phase 4)
# --------------------------------------------------------------------------- #
@router.get("/news", response_model=NewsResponse, tags=["news"])
async def news(feed: str | None = Query(default=None)) -> NewsResponse:
    adapter = _adapter("rss")
    if adapter is None:
        return NewsResponse(status=SourceStatus.SOURCE_DOWN, message="news integration not available.", feed=feed)
    try:
        items = await adapter.get_news(feed)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return NewsResponse(status=status, message=msg, feed=feed)
    status = SourceStatus.OK if items else SourceStatus.EMPTY
    return NewsResponse(status=status, feed=feed, items=items)


# --------------------------------------------------------------------------- #
# calendar (cal) — stub until FRED releases land
# --------------------------------------------------------------------------- #
@router.get("/calendar", response_model=CalendarResponse, tags=["macro"])
async def calendar() -> CalendarResponse:
    return CalendarResponse(
        status=SourceStatus.NOT_IMPLEMENTED,
        message="Economic calendar is not implemented yet.",
    )

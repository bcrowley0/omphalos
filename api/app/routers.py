"""Widget endpoints.

Each endpoint resolves an adapter from the registry, calls the canonical
operation, and maps any adapter exception to an explicit SourceStatus so the
frontend can render loading/source-down/unauth/rate-limited/empty without ever
seeing an unhandled crash (CLAUDE.md hard rule #6).

Phase 1: every call is served by the MockAdapter ("mock"). The source-selection
helper is the seam where the symbol router will choose ibkr/kraken/fred later.
"""

from __future__ import annotations

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
    CalendarResponse,
    CandlesResponse,
    CryptoResponse,
    NewsResponse,
    PortfolioResponse,
    Quote,
    QuoteResponse,
    SourceStatus,
    YieldCurveResponse,
)

logger = logging.getLogger("omphalos.routers")

router = APIRouter()


def _source_for(_symbol: str | None = None) -> str:
    """Choose the source adapter. Phase 1: always mock."""
    return "mock"


def _adapter(name: str) -> Adapter | None:
    return get_registry().get(name)


def _status_from_exc(exc: Exception) -> tuple[SourceStatus, str]:
    """Map an adapter exception to a (status, message) pair."""
    if isinstance(exc, Unauthenticated):
        return SourceStatus.UNAUTHENTICATED, "Source requires authentication."
    if isinstance(exc, RateLimited):
        return SourceStatus.RATE_LIMITED, "Source rate limit hit; try again shortly."
    if isinstance(exc, SourceUnavailable):
        return SourceStatus.SOURCE_DOWN, "Source is unreachable."
    if isinstance(exc, NotSupported):
        return SourceStatus.NOT_IMPLEMENTED, str(exc)
    logger.exception("unexpected adapter error")
    return SourceStatus.SOURCE_DOWN, "Unexpected source error."


# --------------------------------------------------------------------------- #
# chart / quote
# --------------------------------------------------------------------------- #
@router.get("/chart/{symbol}", response_model=CandlesResponse, tags=["market"])
def chart(symbol: str, interval: str = "1d") -> CandlesResponse:
    symbol = symbol.upper()
    source = _source_for(symbol)
    adapter = _adapter(source)
    if adapter is None:
        return CandlesResponse(
            status=SourceStatus.SOURCE_DOWN, message=f"No adapter '{source}'.",
            symbol=symbol, source=source,
        )
    try:
        candles = adapter.get_candles(symbol, interval=interval)
    except Exception as exc:  # noqa: BLE001 - mapped to a UI state, never crashes
        status, msg = _status_from_exc(exc)
        return CandlesResponse(status=status, message=msg, symbol=symbol, source=source)
    logger.info("chart symbol=%s source=%s n=%d", symbol, source, len(candles))
    status = SourceStatus.OK if candles else SourceStatus.EMPTY
    return CandlesResponse(status=status, symbol=symbol, source=source, candles=candles)


@router.get("/quote/{symbol}", response_model=QuoteResponse, tags=["market"])
def quote(symbol: str) -> QuoteResponse:
    symbol = symbol.upper()
    source = _source_for(symbol)
    adapter = _adapter(source)
    if adapter is None:
        return QuoteResponse(status=SourceStatus.SOURCE_DOWN, message=f"No adapter '{source}'.")
    try:
        q: Quote = adapter.get_quote(symbol)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return QuoteResponse(status=status, message=msg)
    logger.info("quote symbol=%s source=%s", symbol, source)
    return QuoteResponse(status=SourceStatus.OK, quote=q)


# --------------------------------------------------------------------------- #
# crypto (ticker + chart for a pair)
# --------------------------------------------------------------------------- #
@router.get("/crypto/{base}/{quote_ccy}", response_model=CryptoResponse, tags=["market"])
def crypto(base: str, quote_ccy: str) -> CryptoResponse:
    pair = f"{base.upper()}/{quote_ccy.upper()}"
    source = "mock"  # Phase 1; later: kraken
    adapter = _adapter(source)
    if adapter is None:
        return CryptoResponse(
            status=SourceStatus.SOURCE_DOWN, message=f"No adapter '{source}'.",
            pair=pair, source=source,
        )
    try:
        q = adapter.get_quote(pair)
        candles = adapter.get_candles(pair)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return CryptoResponse(status=status, message=msg, pair=pair, source=source)
    logger.info("crypto pair=%s source=%s", pair, source)
    status = SourceStatus.OK if candles else SourceStatus.EMPTY
    return CryptoResponse(status=status, pair=pair, source=source, quote=q, candles=candles)


# --------------------------------------------------------------------------- #
# portfolio (positions + balances)
# --------------------------------------------------------------------------- #
@router.get("/portfolio", response_model=PortfolioResponse, tags=["portfolio"])
def portfolio() -> PortfolioResponse:
    adapter = _adapter("mock")  # later: merge ibkr positions + kraken balances
    if adapter is None:
        return PortfolioResponse(status=SourceStatus.SOURCE_DOWN, message="No adapter.")
    try:
        positions = adapter.get_positions()
        balances = adapter.get_balances()
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return PortfolioResponse(status=status, message=msg)
    status = SourceStatus.OK if (positions or balances) else SourceStatus.EMPTY
    return PortfolioResponse(status=status, positions=positions, balances=balances)


# --------------------------------------------------------------------------- #
# yield curve
# --------------------------------------------------------------------------- #
@router.get("/yield", response_model=YieldCurveResponse, tags=["macro"])
def yield_curve() -> YieldCurveResponse:
    adapter = _adapter("mock")  # later: fred
    if adapter is None:
        return YieldCurveResponse(status=SourceStatus.SOURCE_DOWN, message="No adapter.")
    try:
        points = adapter.get_yield_curve()
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return YieldCurveResponse(status=status, message=msg)
    status = SourceStatus.OK if points else SourceStatus.EMPTY
    return YieldCurveResponse(status=status, points=points)


# --------------------------------------------------------------------------- #
# news
# --------------------------------------------------------------------------- #
@router.get("/news", response_model=NewsResponse, tags=["news"])
def news(feed: str | None = Query(default=None)) -> NewsResponse:
    adapter = _adapter("mock")  # later: rss
    if adapter is None:
        return NewsResponse(status=SourceStatus.SOURCE_DOWN, message="No adapter.")
    try:
        items = adapter.get_news(feed)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return NewsResponse(status=status, message=msg, feed=feed)
    status = SourceStatus.OK if items else SourceStatus.EMPTY
    return NewsResponse(status=status, feed=feed, items=items)


# --------------------------------------------------------------------------- #
# calendar (cal) — stub until FRED releases land
# --------------------------------------------------------------------------- #
@router.get("/calendar", response_model=CalendarResponse, tags=["macro"])
def calendar() -> CalendarResponse:
    return CalendarResponse(
        status=SourceStatus.NOT_IMPLEMENTED,
        message="Economic calendar is not implemented yet.",
    )

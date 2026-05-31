"""Widget endpoints.

Each endpoint resolves an adapter from the registry, calls the canonical
operation, and maps any adapter exception to an explicit SourceStatus so the
frontend can render loading/source-down/unauth/rate-limited/empty without ever
seeing an unhandled crash (CLAUDE.md hard rule #6).
"""

from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Query

from .adapters.base import (
    Adapter,
    NotSupported,
    RateLimited,
    SourceUnavailable,
    Unauthenticated,
)
from .adapters.ibkr import IbkrAdapter, gateway_login_url
from .adapters.people import PeopleAdapter, merge_dedupe_sort as merge_people_items
from .adapters.rss import RssAdapter
from .config import Settings, get_settings, update_env_file
from .deps import get_registry
from .models import (
    AddFeedRequest,
    Balance,
    CalendarResponse,
    CandlesResponse,
    FeedError,
    FeedInfo,
    FeedListResponse,
    FollowItem,
    IbkrAuthResponse,
    Interval,
    KeysUpdateRequest,
    NewsResponse,
    PeopleFeedRequest,
    PeopleFeedResponse,
    PortfolioResponse,
    Position,
    Quote,
    QuoteResponse,
    SourceConnection,
    SourceStatus,
    Span,
    StatusResponse,
    YieldCurveResponse,
)
from .symbols import resolve

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


def parse_asof_dates(asof: list[str]) -> tuple[list[date], str | None]:
    """Pure: parse repeated `asof=YYYY-MM-DD` query params. Returns (dates, error);
    on the first malformed value, returns ([], message)."""
    out: list[date] = []
    for raw in asof:
        try:
            out.append(date.fromisoformat(raw))
        except ValueError:
            return [], f"invalid asof date: {raw!r} (expected YYYY-MM-DD)"
    return out, None


# --------------------------------------------------------------------------- #
# chart / quote — symbol resolved to a broker by the name-linking resolver.
# Symbol is a query param so a crypto pair's "/" passes through safely.
# --------------------------------------------------------------------------- #
@router.get("/chart", response_model=CandlesResponse, tags=["market"])
async def chart(
    symbol: str = Query(...), interval: Interval = Interval.H1, span: Span = Span.M1
) -> CandlesResponse:
    r = resolve(symbol)
    adapter = _adapter(r.source)
    if adapter is None:
        return CandlesResponse(
            status=SourceStatus.SOURCE_DOWN,
            message=f"{r.source} integration not available.",
            symbol=r.display,
            source=r.source,
            interval=interval,
            span=span,
        )
    try:
        candles = await adapter.get_candles(r.symbol, interval=interval, span=span)
    except Exception as exc:  # noqa: BLE001 - mapped to a UI state, never crashes
        status, msg = _status_from_exc(exc)
        return CandlesResponse(
            status=status, message=msg, symbol=r.display, source=r.source, interval=interval, span=span
        )
    status = SourceStatus.OK if candles else SourceStatus.EMPTY
    return CandlesResponse(
        status=status, symbol=r.display, source=r.source, candles=candles, interval=interval, span=span
    )


@router.get("/quote", response_model=QuoteResponse, tags=["market"])
async def quote(symbol: str = Query(...)) -> QuoteResponse:
    r = resolve(symbol)
    adapter = _adapter(r.source)
    if adapter is None:
        return QuoteResponse(
            status=SourceStatus.SOURCE_DOWN,
            message=f"{r.source} integration not available.",
        )
    try:
        q: Quote = await adapter.get_quote(r.symbol)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return QuoteResponse(status=status, message=msg)
    return QuoteResponse(status=SourceStatus.OK, quote=q)


# --------------------------------------------------------------------------- #
# portfolio (positions from IBKR + balances from Kraken), each independent
# --------------------------------------------------------------------------- #
@router.get("/portfolio", response_model=PortfolioResponse, tags=["portfolio"])
async def portfolio() -> PortfolioResponse:
    positions: list[Position] = []
    balances: list[Balance] = []
    messages: list[str] = []
    sub_statuses: list[SourceStatus] = []

    ibkr = _adapter("ibkr")
    if ibkr is None:
        sub_statuses.append(SourceStatus.SOURCE_DOWN)
        messages.append("positions: IBKR not connected.")
    else:
        try:
            positions = await ibkr.get_positions()
        except Exception as exc:  # noqa: BLE001
            st, msg = _status_from_exc(exc)
            sub_statuses.append(st)
            messages.append(f"positions: {msg}")

    kraken = _adapter("kraken")
    if kraken is not None:
        try:
            balances = await kraken.get_balances()
        except Exception as exc:  # noqa: BLE001
            st, msg = _status_from_exc(exc)
            sub_statuses.append(st)
            messages.append(f"balances: {msg}")

    # If either source returned rows, the portfolio is usable -> OK (partial).
    # Otherwise pick the most actionable sub-status (auth > rate > down).
    if positions or balances:
        status = SourceStatus.OK
    elif SourceStatus.UNAUTHENTICATED in sub_statuses:
        status = SourceStatus.UNAUTHENTICATED
    elif SourceStatus.RATE_LIMITED in sub_statuses:
        status = SourceStatus.RATE_LIMITED
    elif sub_statuses:
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
async def yield_curve(asof: list[str] = Query(default=[])) -> YieldCurveResponse:
    adapter = _adapter("fred")
    if adapter is None:
        return YieldCurveResponse(status=SourceStatus.SOURCE_DOWN, message="fred integration not available.")
    dates, error = parse_asof_dates(asof)
    if error is not None:
        return YieldCurveResponse(status=SourceStatus.EMPTY, message=error)
    try:
        curves = await adapter.get_yield_curve(dates)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return YieldCurveResponse(status=status, message=msg)
    status = SourceStatus.OK if any(c.points for c in curves) else SourceStatus.EMPTY
    return YieldCurveResponse(status=status, curves=curves)


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


def _rss() -> RssAdapter | None:
    adapter = _adapter("rss")
    return adapter if isinstance(adapter, RssAdapter) else None


@router.get("/news/feeds", response_model=FeedListResponse, tags=["news"])
async def list_feeds() -> FeedListResponse:
    rss = _rss()
    if rss is None:
        return FeedListResponse(status=SourceStatus.SOURCE_DOWN)
    feeds = [FeedInfo(name=n, urls=u) for n, u in rss.list_feeds().items()]
    return FeedListResponse(status=SourceStatus.OK, feeds=feeds)


@router.post("/news/feeds", response_model=FeedListResponse, tags=["news"])
async def add_feed(req: AddFeedRequest) -> FeedListResponse:
    rss = _rss()
    if rss is None:
        return FeedListResponse(status=SourceStatus.SOURCE_DOWN)
    rss.add_feed(req.name, req.url)
    feeds = [FeedInfo(name=n, urls=u) for n, u in rss.list_feeds().items()]
    return FeedListResponse(status=SourceStatus.OK, feeds=feeds)


# --------------------------------------------------------------------------- #
# people feed — follow public figures across news, YouTube, blogs
# --------------------------------------------------------------------------- #
@router.post("/people/feed", response_model=PeopleFeedResponse, tags=["people"])
async def people_feed(req: PeopleFeedRequest) -> PeopleFeedResponse:
    adapter = _adapter("people")
    if not isinstance(adapter, PeopleAdapter):
        return PeopleFeedResponse(status=SourceStatus.SOURCE_DOWN, message="people integration not available.")
    items: list[FollowItem] = []
    errors: list[FeedError] = []
    for p in req.people:
        try:
            person_items = await adapter.get_person_feed(p.name, p.feeds)
            # Keep ALL primary items (first-party + wire-grade/official) so the
            # primary-only view is never starved; cap only secondary rehash.
            primary = [i for i in person_items if i.primary]
            secondary = [i for i in person_items if not i.primary]
            items.extend(primary + secondary[: req.limit_per_person])
        except Exception as exc:  # noqa: BLE001 - one person failing must not kill the rest
            _, msg = _status_from_exc(exc)
            errors.append(FeedError(person=p.name, message=msg))
    items = merge_people_items(items)
    if items:
        status = SourceStatus.OK
    elif errors:
        status = SourceStatus.SOURCE_DOWN
    else:
        status = SourceStatus.EMPTY
    return PeopleFeedResponse(status=status, items=items, errors=errors)


# --------------------------------------------------------------------------- #
# calendar (cal) — stub until FRED releases land
# --------------------------------------------------------------------------- #
@router.get("/calendar", response_model=CalendarResponse, tags=["macro"])
async def calendar() -> CalendarResponse:
    return CalendarResponse(
        status=SourceStatus.NOT_IMPLEMENTED,
        message="Economic calendar is not implemented yet.",
    )


# --------------------------------------------------------------------------- #
# status (settings widget) — non-secret per-source connection status
# --------------------------------------------------------------------------- #
def build_status(settings: Settings) -> StatusResponse:
    """Pure: per-source configured-state + guidance, derived from config presence
    only. Never reads or returns key values (CLAUDE.md hard rule #2)."""
    fred = bool(settings.fred_api_key)
    kraken = bool(settings.kraken_api_key and settings.kraken_api_secret)
    return StatusResponse(
        sources=[
            SourceConnection(
                source="fred",
                configured=fred,
                detail="FRED key set." if fred else "Add FRED_API_KEY to api/.env.",
            ),
            SourceConnection(
                source="kraken",
                configured=kraken,
                detail="Kraken keys set."
                if kraken
                else "Add KRAKEN_API_KEY and KRAKEN_API_SECRET to api/.env.",
            ),
            SourceConnection(
                source="ibkr",
                configured=True,
                detail="Run the Client Portal Gateway and log in at https://localhost:5000.",
            ),
        ]
    )


@router.get("/status", response_model=StatusResponse, tags=["meta"])
async def status() -> StatusResponse:
    return build_status(get_settings())


@router.post("/status/keys", response_model=StatusResponse, tags=["meta"])
async def update_keys(req: KeysUpdateRequest) -> StatusResponse:
    """Local-first key entry (localhost only): write the supplied non-empty keys
    into api/.env and hot-reload settings. Returns the refreshed status only —
    key VALUES are never returned to the browser."""
    env_map = {
        "FRED_API_KEY": req.fred_api_key,
        "KRAKEN_API_KEY": req.kraken_api_key,
        "KRAKEN_API_SECRET": req.kraken_api_secret,
    }
    updates = {name: value.strip() for name, value in env_map.items() if value and value.strip()}
    if updates:
        update_env_file(updates)
    return build_status(get_settings())


# --------------------------------------------------------------------------- #
# IBKR live connection state — one-click "log in at the gateway" UX. Never
# raises (get_auth_state maps every failure to a state); loginUrl is derived
# from config so the frontend never hardcodes the gateway location.
# --------------------------------------------------------------------------- #
_IBKR_DETAIL: dict[str, str] = {
    "authenticated": "Connected to the IBKR gateway.",
    "unauthenticated": "Gateway is running, but you're not logged in.",
    "unreachable": "IBKR gateway not reachable — is the Client Portal Gateway running?",
}


@router.get("/ibkr/auth", response_model=IbkrAuthResponse, tags=["meta"])
async def ibkr_auth() -> IbkrAuthResponse:
    login_url = gateway_login_url(get_settings().ibkr_gateway_base_url)
    adapter = _adapter("ibkr")
    if not isinstance(adapter, IbkrAdapter):
        return IbkrAuthResponse(
            state="unreachable", login_url=login_url, detail="IBKR integration not available."
        )
    state = await adapter.get_auth_state()
    return IbkrAuthResponse(state=state, login_url=login_url, detail=_IBKR_DETAIL[state])

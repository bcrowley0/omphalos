"""Canonical internal data model — the SINGLE SOURCE OF TRUTH for response shapes.

Per CLAUDE.md:
- Every adapter normalizes to these shapes at its boundary; widgets never see
  source-specific formats.
- Timestamps are UTC epoch MILLISECONDS (int).
- The frontend TypeScript types are GENERATED from the OpenAPI schema these
  models produce. Do not hand-write duplicate TS interfaces.

JSON field names are camelCase (matching the canonical model in CLAUDE.md) via an
alias generator; Python code uses idiomatic snake_case internally.
"""

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base: snake_case in Python, camelCase on the wire (both directions)."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


# --------------------------------------------------------------------------- #
# Source status — the explicit, visible UI states required by CLAUDE.md rule 6.
# loading is a frontend-only state; the rest are expressed by the backend so a
# broken source degrades gracefully instead of crashing.
# --------------------------------------------------------------------------- #
class SourceStatus(str, Enum):
    OK = "ok"
    EMPTY = "empty"
    SOURCE_DOWN = "source_down"
    UNAUTHENTICATED = "unauthenticated"
    RATE_LIMITED = "rate_limited"
    NOT_IMPLEMENTED = "not_implemented"


class Interval(str, Enum):
    """Candle size (bar granularity)."""

    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"
    W1 = "1w"


class Span(str, Enum):
    """Chart lookback window."""

    D1 = "1D"
    D5 = "5D"
    M1 = "1M"
    M3 = "3M"
    Y1 = "1Y"
    Y5 = "5Y"


_MIN_MS = 60_000
_DAY_MS = 86_400_000

# Bar length in epoch-ms, per interval.
INTERVAL_MS: dict[Interval, int] = {
    Interval.M1: 1 * _MIN_MS,
    Interval.M5: 5 * _MIN_MS,
    Interval.M15: 15 * _MIN_MS,
    Interval.H1: 60 * _MIN_MS,
    Interval.H4: 240 * _MIN_MS,
    Interval.D1: 1440 * _MIN_MS,
    Interval.W1: 10080 * _MIN_MS,
}

# Lookback window in epoch-ms, per span (calendar approximations).
SPAN_MS: dict[Span, int] = {
    Span.D1: 1 * _DAY_MS,
    Span.D5: 5 * _DAY_MS,
    Span.M1: 30 * _DAY_MS,
    Span.M3: 90 * _DAY_MS,
    Span.Y1: 365 * _DAY_MS,
    Span.Y5: 5 * 365 * _DAY_MS,
}


# --------------------------------------------------------------------------- #
# Canonical entities
# --------------------------------------------------------------------------- #
class Candle(CamelModel):
    t: int  # UTC epoch ms
    o: float
    h: float
    l: float  # noqa: E741 - canonical field name from CLAUDE.md
    c: float
    v: float


class Quote(CamelModel):
    symbol: str
    last: float | None = None
    bid: float | None = None
    ask: float | None = None
    change: float | None = None
    change_pct: float | None = None
    ts: int | None = None  # UTC epoch ms
    stale: bool = False
    source: str


class Position(CamelModel):
    symbol: str
    qty: float
    avg_cost: float
    market_value: float
    unrealized_pnl: float
    source: str
    side: str | None = None  # "long" | "short" — Kraken margin only
    margin_used: float | None = None  # margin committed to this position


class Balance(CamelModel):
    asset: str
    total: float
    available: float
    source: str


class MarginSummary(CamelModel):
    equity: float  # e  = trade balance + unrealized P&L
    used_margin: float  # m  = margin of open positions
    free_margin: float  # mf = equity - initial margin
    margin_level: float | None = None  # ml = (equity/initial margin)*100; None when no positions
    unrealized_pnl: float  # n
    cost_basis: float  # c
    valuation: float  # v  = floating valuation of open positions
    source: str = "kraken"


class NewsItem(CamelModel):
    title: str
    summary: str
    url: str
    published_ts: int | None = None  # UTC epoch ms
    feed: str


class YieldPoint(CamelModel):
    tenor_label: str
    tenor_years: float
    rate_pct: float
    obs_date: int  # UTC epoch ms


class AsOfCurve(CamelModel):
    """A yield curve as of one observation date (latest, a relative lookback, or
    an exact calendar date). `obs_date` is the most recent per-tenor observation
    actually used; `requested_date` is the target as-of date."""

    key: str
    label: str
    requested_date: int
    obs_date: int
    points: list[YieldPoint] = []


class SwapTenorPoint(CamelModel):
    """One standard tenor's summary from a day of SDR swap prints: the median
    fixed rate, how many prints fell in the bucket, and their summed notional."""

    tenor_label: str          # "1Y", "2Y", ... "30Y"
    tenor_years: float        # standard bucket value (e.g. 10.0)
    rate_pct: float           # median fixed rate, percent
    trade_count: int          # prints in this bucket
    total_notional: float     # summed notional (USD); capped prints counted at cap


class SwapCurve(CamelModel):
    """SOFR or US CPI swap rates by tenor, as of one EOD SDR file."""

    key: str                  # "sofr" | "cpi"
    label: str                # human label, e.g. "SOFR OIS"
    obs_date: int             # UTC epoch ms of the file's report date
    points: list[SwapTenorPoint] = []


# --------------------------------------------------------------------------- #
# Response envelopes — each carries an explicit status so the frontend can
# render the right UI state. Loading is handled client-side.
# --------------------------------------------------------------------------- #
class CandlesResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    symbol: str
    source: str
    candles: list[Candle] = []
    interval: Interval = Interval.H1
    span: Span = Span.M1


class QuoteResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    quote: Quote | None = None


class PortfolioResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    positions: list[Position] = []
    balances: list[Balance] = []
    margin_summary: MarginSummary | None = None


class YieldCurveResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    curves: list[AsOfCurve] = []


class SwapsResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    file_date: int | None = None   # UTC epoch ms of the EOD file actually used
    curves: list[SwapCurve] = []


class NewsResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    feed: str | None = None
    items: list[NewsItem] = []


class CalendarResponse(CamelModel):
    """`cal` command. Stubbed in early phases (status = not_implemented)."""

    status: SourceStatus
    message: str | None = None


class FeedInfo(CamelModel):
    name: str
    urls: list[str] = []  # a named source is a group of section feed URLs


class FeedListResponse(CamelModel):
    status: SourceStatus
    feeds: list[FeedInfo] = []


class AddFeedRequest(CamelModel):
    name: str
    url: str


class SuggestedSource(CamelModel):
    name: str
    category: str  # groups the source in the picker UI (e.g. "Wire", "Macro", "Crypto")
    urls: list[str] = []


class CatalogResponse(CamelModel):
    status: SourceStatus
    sources: list[SuggestedSource] = []


class SourceNameRequest(CamelModel):
    name: str


# --------------------------------------------------------------------------- #
# People feed — follow individuals across news, YouTube, blogs, podcasts
# --------------------------------------------------------------------------- #
class FollowItem(CamelModel):
    person: str
    title: str
    summary: str
    url: str
    published_ts: int | None = None  # UTC epoch ms
    source: str  # human label, e.g. "Google News", "YouTube", domain
    kind: str  # "news" | "video" | "podcast" | "blog" | "speech"
    publisher: str | None = None  # the outlet (e.g. "Reuters"); None if unknown
    primary: bool = False  # first-party OR wire-grade/official source (vs rehash)
    relevant: bool = False  # the item is about the person (name in title / first-party)


class PersonAnchors(CamelModel):
    youtube: str | None = None   # @handle | channel URL | channelId — locks the channel
    podcast: str | None = None   # podcast feed URL — locks the show
    writing: list[str] = []      # blog/Substack/Medium RSS — writing's only source


class PersonRef(CamelModel):
    name: str
    # Per-content-type on/off. Missing key => default-on, EXCEPT "writing" which is
    # on iff an anchor exists. Keys: news | videos | podcasts | speeches | writing.
    enabled: dict[str, bool] = {}
    anchors: PersonAnchors = PersonAnchors()


class PeopleFeedRequest(CamelModel):
    people: list[PersonRef] = []
    limit_per_person: int = 25


class FeedError(CamelModel):
    person: str
    message: str


class PeopleFeedResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    items: list[FollowItem] = []
    errors: list[FeedError] = []


# --------------------------------------------------------------------------- #
# Connection status — non-secret. Reports whether each source is configured and
# how to fix it; NEVER carries key values (CLAUDE.md hard rule #2).
# --------------------------------------------------------------------------- #
class SourceConnection(CamelModel):
    source: str
    configured: bool
    detail: str


class StatusResponse(CamelModel):
    sources: list[SourceConnection] = []


# Local-first key entry (localhost only). Only non-empty fields are written to
# api/.env. The response is plain StatusResponse — key values are never echoed.
class KeysUpdateRequest(CamelModel):
    fred_api_key: str | None = None
    kraken_api_key: str | None = None
    kraken_api_secret: str | None = None


# --------------------------------------------------------------------------- #
# IBKR live connection state — drives the one-click "log in at the gateway" UX.
# `loginUrl` is derived from IBKR_GATEWAY_BASE_URL on the backend so the frontend
# never hardcodes the gateway location. Carries no secrets.
# --------------------------------------------------------------------------- #
IbkrAuthState = Literal["authenticated", "unauthenticated", "unreachable"]


class IbkrAuthResponse(CamelModel):
    state: IbkrAuthState
    login_url: str | None = None
    detail: str

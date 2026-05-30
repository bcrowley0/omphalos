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


class Balance(CamelModel):
    asset: str
    total: float
    available: float
    source: str


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


class QuoteResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    quote: Quote | None = None


class CryptoResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    pair: str
    source: str
    quote: Quote | None = None
    candles: list[Candle] = []


class PortfolioResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    positions: list[Position] = []
    balances: list[Balance] = []


class YieldCurveResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    points: list[YieldPoint] = []


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
    url: str


class FeedListResponse(CamelModel):
    status: SourceStatus
    feeds: list[FeedInfo] = []


class AddFeedRequest(CamelModel):
    name: str
    url: str


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
    kind: str  # "news" | "video" | "blog" | "podcast"


class PersonRef(CamelModel):
    name: str
    feeds: list[str] = []  # optional custom feed URLs (blog / YouTube / podcast)


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

"""Common adapter interface (CLAUDE.md hard rule #3).

One common interface; each source implements only the subset it supports. A
source that doesn't support an operation raises `NotSupported`; callers catch it
and surface a graceful UI state rather than crashing.

Read-only v1: `place_order` is stubbed to raise NotImplementedError and is never
wired to a route (hard rule #4).
"""

from __future__ import annotations

from datetime import date

from ..models import AsOfCurve, Balance, Candle, NewsItem, Position, Quote


class NotSupported(Exception):
    """Raised when an adapter does not implement a given capability."""


class SourceUnavailable(Exception):
    """The source could not be reached (network/gateway down)."""


class Unauthenticated(Exception):
    """The source requires auth that is missing or invalid."""


class RateLimited(Exception):
    """The source rejected the call for rate-limiting reasons."""


class Adapter:
    """Base adapter. Subclasses override the operations they support.

    The default implementations raise NotSupported so an unimplemented
    capability is explicit, never a silent wrong answer.
    """

    #: stable lowercase identifier, e.g. "mock", "kraken", "ibkr", "fred"
    name: str = "base"

    async def get_candles(self, symbol: str, interval: str = "1d") -> list[Candle]:
        raise NotSupported(f"{self.name} does not support candles")

    async def get_quote(self, symbol: str) -> Quote:
        raise NotSupported(f"{self.name} does not support quotes")

    async def get_positions(self) -> list[Position]:
        raise NotSupported(f"{self.name} does not support positions")

    async def get_balances(self) -> list[Balance]:
        raise NotSupported(f"{self.name} does not support balances")

    async def get_news(self, feed: str | None = None) -> list[NewsItem]:
        raise NotSupported(f"{self.name} does not support news")

    async def get_yield_curve(self, asof_dates: list[date]) -> list[AsOfCurve]:
        raise NotSupported(f"{self.name} does not support a yield curve")

    def place_order(self, *args, **kwargs):  # noqa: ANN002, ANN003
        # Read-only v1. Never expose this. (CLAUDE.md hard rule #4)
        raise NotImplementedError("Order entry is intentionally not implemented (read-only v1)")

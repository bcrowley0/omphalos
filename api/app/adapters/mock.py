"""MockAdapter — fake data in canonical shapes for Phase 1.

Implements every capability so the whole UX can be proven before any real API.
Data is deterministic per symbol (seeded) so charts look stable across refreshes,
with timestamps anchored to the current time.
"""

from __future__ import annotations

import hashlib
import math
import time
from datetime import date

from ..models import (
    AsOfCurve,
    Balance,
    Candle,
    INTERVAL_MS,
    Interval,
    NewsItem,
    Position,
    Quote,
    SPAN_MS,
    Span,
    YieldPoint,
)
from .base import Adapter


def _seed(symbol: str) -> int:
    return int(hashlib.sha256(symbol.encode()).hexdigest(), 16) % 10_000


def _now_ms() -> int:
    return int(time.time() * 1000)


class MockAdapter(Adapter):
    name = "mock"

    # -- candles ----------------------------------------------------------- #
    async def get_candles(
        self, symbol: str, interval: Interval = Interval.D1, span: Span = Span.M1
    ) -> list[Candle]:
        step = INTERVAL_MS[interval]
        count = min(max(SPAN_MS[span] // step, 2), 720)
        seed = _seed(symbol)
        base = 50 + (seed % 450)  # base price 50..500
        now = _now_ms()
        candles: list[Candle] = []
        price = float(base)
        for i in range(count):
            t = now - (count - 1 - i) * step
            # deterministic pseudo-random walk
            drift = math.sin((i + seed) / 9.0) * (base * 0.02)
            wobble = math.cos((i * 1.7 + seed) / 5.0) * (base * 0.015)
            o = price
            c = max(1.0, price + drift)
            hi = max(o, c) + abs(wobble)
            lo = min(o, c) - abs(wobble)
            v = 1_000_000 + (seed * 7 + i * 131) % 4_000_000
            candles.append(
                Candle(t=t, o=round(o, 2), h=round(hi, 2), l=round(lo, 2), c=round(c, 2), v=float(v))
            )
            price = c
        return candles

    # -- quote ------------------------------------------------------------- #
    async def get_quote(self, symbol: str) -> Quote:
        candles = await self.get_candles(symbol)
        prev, latest = candles[-2].c, candles[-1].c
        change = round(latest - prev, 2)
        change_pct = round((change / prev) * 100, 2) if prev else 0.0
        spread = round(latest * 0.0005, 2)
        return Quote(
            symbol=symbol,
            last=latest,
            bid=round(latest - spread, 2),
            ask=round(latest + spread, 2),
            change=change,
            change_pct=change_pct,
            ts=_now_ms(),
            stale=False,
            source=self.name,
        )

    # -- portfolio --------------------------------------------------------- #
    async def get_positions(self) -> list[Position]:
        rows = [("AAPL", 50, 150.0), ("MSFT", 20, 300.0), ("NVDA", 15, 450.0)]
        out: list[Position] = []
        for sym, qty, avg in rows:
            last = (await self.get_quote(sym)).last or avg
            mv = round(last * qty, 2)
            out.append(
                Position(
                    symbol=sym,
                    qty=qty,
                    avg_cost=avg,
                    market_value=mv,
                    unrealized_pnl=round(mv - avg * qty, 2),
                    source=self.name,
                )
            )
        return out

    async def get_balances(self) -> list[Balance]:
        return [
            Balance(asset="USD", total=12_500.00, available=12_500.00, source=self.name),
            Balance(asset="BTC", total=0.75, available=0.75, source=self.name),
            Balance(asset="ETH", total=4.2, available=4.0, source=self.name),
        ]

    # -- news -------------------------------------------------------------- #
    async def get_news(self, feed: str | None = None) -> list[NewsItem]:
        feed_name = feed or "Mock Wire"
        now = _now_ms()
        headlines = [
            ("Markets steady as traders weigh rate path", "Equities little changed in light trading."),
            ("Tech leads modest gains on Wall Street", "Chipmakers outperform; energy lags."),
            ("Treasury yields edge lower ahead of data", "Short end steady; long end slips."),
            ("Crypto majors consolidate near recent highs", "BTC holds support; ETH ranges."),
        ]
        return [
            NewsItem(
                title=title,
                summary=summary,
                url="https://example.com/article/%d" % i,
                published_ts=now - i * 3_600_000,
                feed=feed_name,
            )
            for i, (title, summary) in enumerate(headlines)
        ]

    # -- yield curve ------------------------------------------------------- #
    async def get_yield_curve(self, asof_dates: list[date]) -> list[AsOfCurve]:
        # (label, years) for the canonical Treasury tenor set
        tenors = [
            ("1M", 1 / 12), ("3M", 0.25), ("6M", 0.5), ("1Y", 1.0), ("2Y", 2.0),
            ("3Y", 3.0), ("5Y", 5.0), ("7Y", 7.0), ("10Y", 10.0), ("20Y", 20.0), ("30Y", 30.0),
        ]
        obs = _now_ms()
        points = [
            YieldPoint(
                tenor_label=label,
                tenor_years=round(years, 4),
                rate_pct=round(3.8 + 0.55 * math.log1p(years), 2),
                obs_date=obs,
            )
            for label, years in tenors
        ]
        return [AsOfCurve(key="current", label="Today", requested_date=obs, obs_date=obs, points=points)]

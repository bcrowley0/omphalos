"""News — ONE generic RSS adapter (see .claude/rules/fred-and-news.md).

Accepts ANY feed URL, parses title/summary/link/publishedTs SERVER-SIDE with
feedparser (avoids browser CORS). FT, WSJ, Bloomberg, CNBC + Economist
preconfigured (section feeds per source); feed URLs can be added at runtime.
Headlines + one-line teaser ONLY — render links OUT; NEVER fetch or scrape full
article bodies (paywalled; ToS). Short-TTL cache per feed.
"""

from __future__ import annotations

import asyncio
import calendar
import re
import threading
from time import struct_time
from typing import Any

import feedparser

from ..cache import cache
from ..http import get_text
from ..models import NewsItem
from .base import Adapter, SourceUnavailable

_FEED_TTL = 60.0
_MAX_ITEMS = 30  # per individual feed
_MAX_AGG = 60  # per named source after merging its feeds
_UA = "Mozilla/5.0 (Omphalos RSS reader)"

# Preconfigured sources (name -> LIST of feed URLs). Each named source fans out
# across several section feeds so the newest headlines surface regardless of
# section. Names are matched case-insensitively. Every URL below was verified to
# return live items (HTTP 200, parseable by feedparser) when this list was set.
#
# Notes:
#   WSJ — the old `feeds.a.dj.com` host is dead (months-stale); live host is
#         `feeds.content.dowjones.io/public/rss/<NAME>`.
#   FT  — `ft.com/<section>?format=rss`.
#   BB  — `feeds.bloomberg.com/<topic>/news.rss`; `bview` is Bloomberg Opinion.
#   CNBC — opaque numeric section ids on the search-cms endpoint; the id->topic
#          mapping is documented inline (verified against each feed's channel title).
#   ECON — `economist.com/<section>/rss.xml` (large feeds; capped per `_MAX_ITEMS`).
# Lifestyle/arts/pursuits-style sections are intentionally omitted (off-domain for
# a finance terminal); add them at runtime via `add_feed` if wanted.
_WSJ = "https://feeds.content.dowjones.io/public/rss"
_FT = "https://www.ft.com"
_BB = "https://feeds.bloomberg.com"
_CNBC = "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id="
_ECON = "https://www.economist.com"
# X (Twitter) has no native RSS — these accounts are bridged via a Nitter
# instance (`<base>/<handle>/rss`). Nitter instances are VOLATILE: they get rate
# limited or go offline without notice, so the base is isolated here as the single
# swap point. A dead instance only blanks the X feeds (the adapter skips failing
# feeds per rule #3) — swap `_NITTER` for a live instance to restore them.
# These are public-post "squawk"/headline accounts; we surface post text only and
# link OUT, never scraping article bodies.
_NITTER = "https://nitter.net"
_DEFAULT_FEEDS: dict[str, list[str]] = {
    "FT": [
        f"{_FT}/rss/home",
        f"{_FT}/world?format=rss",
        f"{_FT}/global-economy?format=rss",
        f"{_FT}/companies?format=rss",
        f"{_FT}/markets?format=rss",
        f"{_FT}/technology?format=rss",
        f"{_FT}/us?format=rss",
        f"{_FT}/opinion?format=rss",
    ],
    "WSJ": [
        f"{_WSJ}/RSSMarketsMain",
        f"{_WSJ}/RSSWorldNews",
        f"{_WSJ}/WSJcomUSBusiness",
        f"{_WSJ}/RSSWSJD",
        f"{_WSJ}/RSSOpinion",
        f"{_WSJ}/RSSPersonalFinance",
    ],
    "BLOOMBERG": [
        f"{_BB}/markets/news.rss",
        f"{_BB}/technology/news.rss",
        f"{_BB}/economics/news.rss",
        f"{_BB}/politics/news.rss",
        f"{_BB}/industries/news.rss",
        f"{_BB}/bview/news.rss",  # Bloomberg Opinion
        f"{_BB}/wealth/news.rss",
        f"{_BB}/green/news.rss",
        f"{_BB}/crypto/news.rss",
    ],
    "CNBC": [
        f"{_CNBC}100003114",  # Top News
        f"{_CNBC}10001147",  # Business News
        f"{_CNBC}10000664",  # Finance
        f"{_CNBC}15839069",  # Investing
        f"{_CNBC}20910258",  # Economy
        f"{_CNBC}15839135",  # Earnings
        f"{_CNBC}19854910",  # Technology
        f"{_CNBC}100727362",  # International
    ],
    "ECONOMIST": [
        f"{_ECON}/finance-and-economics/rss.xml",
        f"{_ECON}/business/rss.xml",
        f"{_ECON}/the-world-this-week/rss.xml",
        f"{_ECON}/international/rss.xml",
        f"{_ECON}/united-states/rss.xml",
        f"{_ECON}/science-and-technology/rss.xml",
    ],
    # X accounts (bridged via Nitter — see _NITTER note). Each is its own named
    # source so `news <handle>` works and items are labelled by account.
    "FINANCIALJUICE": [f"{_NITTER}/financialjuice/rss"],
    "DEITAONE": [f"{_NITTER}/DeItaone/rss"],  # Walter Bloomberg
    "NICKTIMIRAOS": [f"{_NITTER}/NickTimiraos/rss"],  # WSJ Fed reporter
    "FIRSTSQUAWK": [f"{_NITTER}/FirstSquawk/rss"],
    "ZOOMERFIED": [f"{_NITTER}/zoomerfied/rss"],
}

# Pseudo-source name that aggregates every configured source into one feed.
_ALL = "ALL"

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    return _TAG_RE.sub("", text or "").strip()


def _normalize_link(url: str) -> str:
    """Rewrite Nitter bridge permalinks to the canonical x.com post.

    The Nitter instance is flaky/often offline, so a story should link OUT to the
    real tweet, not the bridge. `<base>/user/status/123#m` -> `x.com/user/status/123`.
    Non-bridge URLs pass through unchanged.
    """
    if url.startswith(_NITTER):
        url = "https://x.com" + url[len(_NITTER) :]
        if url.endswith("#m"):
            url = url[:-2]
    return url


def _struct_to_ms(t: struct_time | None) -> int | None:
    # feedparser yields UTC struct_time in *_parsed fields.
    return int(calendar.timegm(t) * 1000) if t else None


def parse_feed(xml: str, feed_label: str) -> list[NewsItem]:
    """Pure: RSS/Atom XML -> canonical NewsItems (headline + teaser only)."""
    parsed = feedparser.parse(xml)
    items: list[NewsItem] = []
    for entry in parsed.entries[:_MAX_ITEMS]:
        title = _strip_html(getattr(entry, "title", "")) or "(untitled)"
        summary = _strip_html(getattr(entry, "summary", ""))
        if summary == title:
            summary = ""  # X/tweet feeds repeat the title as the body — don't show it twice
        elif len(summary) > 280:
            summary = summary[:277].rstrip() + "…"
        published = _struct_to_ms(
            getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
        )
        items.append(
            NewsItem(
                title=title,
                summary=summary,
                url=_normalize_link(getattr(entry, "link", "") or ""),
                published_ts=published,
                feed=feed_label,
            )
        )
    return items


def _recency_key(item: NewsItem) -> tuple[bool, int]:
    # Dated items sort above undated; newest first within each.
    return (item.published_ts is not None, item.published_ts or 0)


def dedupe_sort_news(items: list[NewsItem]) -> list[NewsItem]:
    """Dedupe by URL, sort newest-first (None publishedTs sinks last). Pure."""
    by_url: dict[str, NewsItem] = {}
    for it in items:
        if it.url and it.url not in by_url:
            by_url[it.url] = it
    return sorted(by_url.values(), key=_recency_key, reverse=True)


def interleave_by_source(items: list[NewsItem], limit: int) -> list[NewsItem]:
    """Dedupe by URL, then round-robin across sources (by `feed` label) up to
    `limit`. Pure.

    A plain recency sort lets a high-frequency source (e.g. a squawk account that
    posts every few minutes) crowd lower-cadence sources out of a capped aggregate
    entirely. Round-robin guarantees every source appears: newest-first within each
    source, sources ordered by their freshest item so the overall newest still
    leads. With one source this degrades to pure recency.
    """
    by_url: dict[str, NewsItem] = {}
    for it in items:
        if it.url and it.url not in by_url:
            by_url[it.url] = it
    groups: dict[str, list[NewsItem]] = {}
    for it in by_url.values():
        groups.setdefault(it.feed, []).append(it)
    for g in groups.values():
        g.sort(key=_recency_key, reverse=True)
    ranked = sorted(groups.values(), key=lambda g: _recency_key(g[0]), reverse=True)

    out: list[NewsItem] = []
    for tier in range(max((len(g) for g in ranked), default=0)):
        for g in ranked:
            if tier < len(g):
                out.append(g[tier])
                if len(out) >= limit:
                    return out
    return out


class RssAdapter(Adapter):
    name = "rss"

    def __init__(self) -> None:
        # name -> list of feed URLs (a "source" is a group of section feeds)
        self._feeds: dict[str, list[str]] = {k: list(v) for k, v in _DEFAULT_FEEDS.items()}
        self._lock = threading.Lock()

    # -- feed registry (runtime-configurable) ------------------------------ #
    def list_feeds(self) -> dict[str, list[str]]:
        with self._lock:
            return {k: list(v) for k, v in self._feeds.items()}

    def add_feed(self, name: str, url: str) -> None:
        """Append a feed URL to a named source (creating it if new)."""
        with self._lock:
            urls = self._feeds.setdefault(name.upper(), [])
            if url not in urls:
                urls.append(url)

    def _targets(self, feed: str | None) -> tuple[str, list[tuple[str, str]]]:
        """Return (cache_label, [(item_label, url), ...]) to fetch.

        `feed` may be None / "all" (aggregate EVERY source, each item labelled by
        its source name), a source name, or a raw URL. Each item's label becomes
        its `feed` field so an aggregated view shows where each story came from.
        """
        if not feed or feed.upper() == _ALL:
            with self._lock:
                pairs = [(name, url) for name, urls in self._feeds.items() for url in urls]
            return _ALL, pairs
        if feed.lower().startswith(("http://", "https://")):
            return feed, [(feed, feed)]
        with self._lock:
            urls = self._feeds.get(feed.upper())
        if urls is None:
            raise SourceUnavailable(f"Unknown feed '{feed}'. Known: {', '.join(self._feeds)}")
        return feed.upper(), [(feed.upper(), url) for url in urls]

    async def get_news(self, feed: str | None = None) -> list[NewsItem]:
        cache_label, targets = self._targets(feed)

        async def fetch() -> list[NewsItem]:
            async def one(label: str, url: str) -> list[NewsItem]:
                try:
                    xml = await get_text(
                        url, source="rss", headers={"User-Agent": _UA}, follow_redirects=True
                    )
                except Exception:  # noqa: BLE001 - skip a single bad feed, keep the rest
                    return []
                return parse_feed(xml, label)

            results = await asyncio.gather(*(one(lbl, u) for lbl, u in targets))
            merged = interleave_by_source([it for sub in results for it in sub], _MAX_AGG)
            if not merged and targets:
                raise SourceUnavailable(f"No items from {cache_label}")
            return merged

        key = f"rss:{cache_label}:{','.join(sorted(u for _, u in targets))}"
        return await cache.get_or_set(key, _FEED_TTL, fetch)

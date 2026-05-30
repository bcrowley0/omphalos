"""News — ONE generic RSS adapter (see .claude/rules/fred-and-news.md).

Accepts ANY feed URL, parses title/summary/link/publishedTs SERVER-SIDE with
feedparser (avoids browser CORS). FT + WSJ preconfigured; feed URLs can be added
at runtime. Headlines + one-line teaser ONLY — render links OUT; NEVER fetch or
scrape full article bodies (paywalled; ToS). Short-TTL cache per feed.
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
# section. Names are matched case-insensitively.
#
# WSJ note: the old `feeds.a.dj.com` host is dead (months-stale); the live host
# is `feeds.content.dowjones.io/public/rss/<NAME>`.
_WSJ = "https://feeds.content.dowjones.io/public/rss"
_FT = "https://www.ft.com"
_DEFAULT_FEEDS: dict[str, list[str]] = {
    "FT": [
        f"{_FT}/rss/home",
        f"{_FT}/world?format=rss",
        f"{_FT}/global-economy?format=rss",
        f"{_FT}/companies?format=rss",
        f"{_FT}/markets?format=rss",
        f"{_FT}/technology?format=rss",
        f"{_FT}/us?format=rss",
    ],
    "WSJ": [
        f"{_WSJ}/RSSMarketsMain",
        f"{_WSJ}/RSSWorldNews",
        f"{_WSJ}/WSJcomUSBusiness",
        f"{_WSJ}/RSSWSJD",
        f"{_WSJ}/RSSOpinion",
        f"{_WSJ}/RSSPersonalFinance",
    ],
}

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    return _TAG_RE.sub("", text or "").strip()


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
        if len(summary) > 280:
            summary = summary[:277].rstrip() + "…"
        published = _struct_to_ms(
            getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
        )
        items.append(
            NewsItem(
                title=title,
                summary=summary,
                url=getattr(entry, "link", "") or "",
                published_ts=published,
                feed=feed_label,
            )
        )
    return items


def dedupe_sort_news(items: list[NewsItem]) -> list[NewsItem]:
    """Dedupe by URL, sort newest-first (None publishedTs sinks last). Pure."""
    by_url: dict[str, NewsItem] = {}
    for it in items:
        if it.url and it.url not in by_url:
            by_url[it.url] = it
    return sorted(
        by_url.values(),
        key=lambda i: (i.published_ts is not None, i.published_ts or 0),
        reverse=True,
    )


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

    def _resolve(self, feed: str | None) -> tuple[str, list[str]]:
        """Return (label, urls). `feed` may be a name, a raw URL, or None (default)."""
        if not feed:
            # default to the first configured source (FT)
            name = next(iter(self._feeds))
            return name, list(self._feeds[name])
        if feed.lower().startswith(("http://", "https://")):
            return feed, [feed]  # raw URL; label is the URL
        with self._lock:
            urls = self._feeds.get(feed.upper())
        if urls is None:
            raise SourceUnavailable(f"Unknown feed '{feed}'. Known: {', '.join(self._feeds)}")
        return feed.upper(), list(urls)

    async def get_news(self, feed: str | None = None) -> list[NewsItem]:
        label, urls = self._resolve(feed)

        async def fetch() -> list[NewsItem]:
            async def one(url: str) -> list[NewsItem]:
                try:
                    xml = await get_text(
                        url, source="rss", headers={"User-Agent": _UA}, follow_redirects=True
                    )
                except Exception:  # noqa: BLE001 - skip a single bad section feed
                    return []
                return parse_feed(xml, label)

            results = await asyncio.gather(*(one(u) for u in urls))
            merged = dedupe_sort_news([it for sub in results for it in sub])
            if not merged and urls:
                raise SourceUnavailable(f"No items from {label}")
            return merged[:_MAX_AGG]

        # cache per source (label + its set of urls), so adding a feed busts it
        key = f"rss:{label}:{','.join(sorted(urls))}"
        return await cache.get_or_set(key, _FEED_TTL, fetch)

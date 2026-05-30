"""News — ONE generic RSS adapter (see .claude/rules/fred-and-news.md).

Accepts ANY feed URL, parses title/summary/link/publishedTs SERVER-SIDE with
feedparser (avoids browser CORS). FT + WSJ preconfigured; feed URLs can be added
at runtime. Headlines + one-line teaser ONLY — render links OUT; NEVER fetch or
scrape full article bodies (paywalled; ToS). Short-TTL cache per feed.
"""

from __future__ import annotations

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
_MAX_ITEMS = 30
_UA = "Mozilla/5.0 (Omphalos RSS reader)"

# Preconfigured feeds (name -> url). Names are matched case-insensitively.
_DEFAULT_FEEDS: dict[str, str] = {
    "FT": "https://www.ft.com/rss/home",
    "WSJ": "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
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


class RssAdapter(Adapter):
    name = "rss"

    def __init__(self) -> None:
        self._feeds: dict[str, str] = dict(_DEFAULT_FEEDS)
        self._lock = threading.Lock()

    # -- feed registry (runtime-configurable) ------------------------------ #
    def list_feeds(self) -> dict[str, str]:
        with self._lock:
            return dict(self._feeds)

    def add_feed(self, name: str, url: str) -> None:
        with self._lock:
            self._feeds[name.upper()] = url

    def _resolve(self, feed: str | None) -> tuple[str, str]:
        """Return (label, url). `feed` may be a name, a URL, or None (default)."""
        if not feed:
            # default to the first configured feed (FT)
            name = next(iter(self._feeds))
            return name, self._feeds[name]
        if feed.lower().startswith(("http://", "https://")):
            return feed, feed  # raw URL; label is the URL
        with self._lock:
            url = self._feeds.get(feed.upper())
        if url is None:
            raise SourceUnavailable(f"Unknown feed '{feed}'. Known: {', '.join(self._feeds)}")
        return feed.upper(), url

    async def get_news(self, feed: str | None = None) -> list[NewsItem]:
        label, url = self._resolve(feed)

        async def fetch() -> list[NewsItem]:
            xml = await get_text(
                url, source="rss", headers={"User-Agent": _UA}, follow_redirects=True
            )
            return parse_feed(xml, label)

        return await cache.get_or_set(f"rss:{url}", _FEED_TTL, fetch)

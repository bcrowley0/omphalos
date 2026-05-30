"""People — follow public figures and aggregate public items about/by them.

Stateless: the follow-list lives client-side; each request names the people (and
any custom feed URLs) to fetch. Reuses the RSS infra (parse_feed) and the shared
httpx layer + TTL cache. Sources per person: a Google News RSS *search* on the
name (free, no key, headlines link out) plus optional first-party feeds.
"""

from __future__ import annotations

import asyncio
import urllib.parse
from typing import Any

from ..cache import cache
from ..http import get_text
from ..models import FollowItem, NewsItem
from .base import Adapter, SourceUnavailable
from .rss import _UA, parse_feed

_PERSON_TTL = 1800.0  # 30 min — "daily catch-up", avoids hammering
_GOOGLE_NEWS = "Google News"


def google_news_search_url(name: str) -> str:
    """Exact-name Google News RSS search URL. Pure/testable."""
    q = urllib.parse.quote(f'"{name}"')
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def derive_kind(url: str) -> str:
    """Classify an item by its source URL. Pure/testable."""
    u = url.lower()
    if "youtube.com" in u or "youtu.be" in u:
        return "video"
    if "news.google.com" in u:
        return "news"
    return "blog"


def to_follow_items(news: list[NewsItem], person: str, source_label: str) -> list[FollowItem]:
    """Convert canonical NewsItems -> FollowItems, tagging person/kind/source."""
    return [
        FollowItem(
            person=person,
            title=n.title,
            summary=n.summary,
            url=n.url,
            published_ts=n.published_ts,
            source=source_label,
            kind=derive_kind(n.url),
        )
        for n in news
    ]


def merge_dedupe_sort(items: list[FollowItem]) -> list[FollowItem]:
    """Dedupe by URL, sort newest-first (None publishedTs sinks last). Pure."""
    by_url: dict[str, FollowItem] = {}
    for it in items:
        if it.url and it.url not in by_url:
            by_url[it.url] = it
    return sorted(by_url.values(), key=lambda i: (i.published_ts is not None, i.published_ts or 0), reverse=True)


class PeopleAdapter(Adapter):
    name = "people"

    def __init__(self) -> None:
        self._client: Any = None  # tests may inject an httpx.AsyncClient (MockTransport)

    async def _fetch(self, url: str) -> str:
        return await get_text(url, source="people", client=self._client, headers={"User-Agent": _UA}, follow_redirects=True)

    async def get_person_feed(self, name: str, feeds: list[str] | None = None) -> list[FollowItem]:
        feeds = feeds or []
        sources: list[tuple[str, str]] = [(google_news_search_url(name), _GOOGLE_NEWS)]
        for f in feeds:
            label = "YouTube" if "youtube" in f.lower() else urllib.parse.urlparse(f).netloc or f
            sources.append((f, label))

        async def fetch_all() -> list[FollowItem]:
            async def one(url: str, label: str) -> list[FollowItem]:
                try:
                    xml = await self._fetch(url)
                except Exception:  # noqa: BLE001 - skip a single bad feed, keep the rest
                    return []
                return to_follow_items(parse_feed(xml, label), name, label)

            results = await asyncio.gather(*(one(u, l) for u, l in sources))
            flat = [it for sub in results for it in sub]
            if not flat:
                raise SourceUnavailable(f"No items found for {name}")
            return merge_dedupe_sort(flat)

        key = f"people:{name}:{','.join(sorted(feeds))}"
        return await cache.get_or_set(key, _PERSON_TTL, fetch_all)

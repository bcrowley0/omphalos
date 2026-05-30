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
from .rss import parse_feed

_PERSON_TTL = 1800.0  # 30 min — "daily catch-up", avoids hammering
_GOOGLE_NEWS = "Google News"
_UA = "Mozilla/5.0 (Omphalos RSS reader)"


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


# Publishers treated as "primary": wire-grade original reporting + press-release
# wires. Matched case-insensitively as substrings of the publisher name. First-
# party content (the person's own attached feeds) is always primary regardless.
_PRIMARY_PUBLISHERS = (
    "reuters",
    "bloomberg",
    "associated press",
    "financial times",
    "wall street journal",
    "wsj",
    "pr newswire",
    "prnewswire",
    "business wire",
    "businesswire",
    "globenewswire",
    "globe newswire",
)


def extract_publisher(title: str) -> tuple[str, str | None]:
    """Google News titles end with ' - <Publisher>'. Return (clean_title,
    publisher), splitting on the LAST ' - '. Pure/testable."""
    head, sep, tail = title.rpartition(" - ")
    if sep and head and tail:
        return head.strip(), tail.strip()
    return title, None


def is_primary_publisher(publisher: str | None) -> bool:
    """True if the publisher is a wire-grade/official/press-release source. Pure."""
    if not publisher:
        return False
    p = publisher.lower()
    return any(name in p for name in _PRIMARY_PUBLISHERS)


def to_follow_items(news: list[NewsItem], person: str, source_label: str) -> list[FollowItem]:
    """Convert canonical NewsItems -> FollowItems, tagging person/kind/source and
    classifying primary vs secondary. Google News items derive their publisher
    from the title suffix (which is stripped from the display title); first-party
    feeds (anything not Google News) are always primary."""
    first_party = source_label != _GOOGLE_NEWS
    items: list[FollowItem] = []
    for n in news:
        if first_party:
            title, publisher, primary = n.title, source_label, True
        else:
            title, publisher = extract_publisher(n.title)
            primary = is_primary_publisher(publisher)
        items.append(
            FollowItem(
                person=person,
                title=title,
                summary=n.summary,
                url=n.url,
                published_ts=n.published_ts,
                source=source_label,
                kind=derive_kind(n.url),
                publisher=publisher,
                primary=primary,
            )
        )
    return items


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

"""People — follow public figures and aggregate public items about/by them.

Stateless: the follow-list lives client-side; each request names the people (and
any custom feed URLs) to fetch. Reuses the RSS infra (parse_feed) and the shared
httpx layer + TTL cache. Sources per person: a Google News RSS *search* on the
name (free, no key, headlines link out) plus optional first-party feeds.
"""

from __future__ import annotations

import asyncio
import re
import urllib.parse
from typing import Any

from ..cache import cache
from ..dedupe import dedupe_by_url_recent
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


# Talk/speech keywords: a video OR podcast item whose title matches is a "speech".
_SPEECH_KEYWORDS = (
    "keynote", "talk", "lecture", "fireside", "interview", "testimony",
    "address", "speaks at", "conference", "summit", "panel", "commencement",
    "q&a", "qanda", "remarks", "speech",
)

_SPEECH_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _SPEECH_KEYWORDS) + r")\b", re.IGNORECASE
)
# "address" as a speech must not match technical uses like "MAC address" or
# "IP address" — require it is NOT preceded by an all-caps or network-style token.
_ADDRESS_EXCLUDE_RE = re.compile(r"\b(?:[A-Z]{2,}|ip|mac|url|dns|web)\s+address\b", re.IGNORECASE)


def classify_speech(title: str) -> bool:
    """True if a video/audio title looks like a talk/speech (whole-word match, so
    'talking'/'addressable' don't false-positive). Pure/testable."""
    if not _SPEECH_RE.search(title):
        return False
    # If the only keyword match is "address" in a technical context, suppress it.
    without_tech_address = _ADDRESS_EXCLUDE_RE.sub("", title)
    return bool(_SPEECH_RE.search(without_tech_address))


def classify_feed_url(url: str) -> str:
    """Route an attached/anchored URL to 'youtube' | 'podcast' | 'writing'. Pure."""
    u = url.lower().strip()
    if u.startswith("@") or "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    if "podcasts.apple.com" in u or "megaphone" in u or "libsyn" in u or "/podcast" in u or "feeds.simplecast" in u:
        return "podcast"
    return "writing"


def itunes_search_url(name: str) -> str:
    """Keyless iTunes podcast search for a person's shows. Pure/testable."""
    q = urllib.parse.quote(name, safe="")
    return f"https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&term={q}"


def youtube_search_url(name: str) -> str:
    """YouTube results page filtered to channels (sp=EgIQAg) for name->channel
    discovery. Pure/testable."""
    q = urllib.parse.quote(name, safe="")
    return f"https://www.youtube.com/results?search_query={q}&sp=EgIQAg%3D%3D"


def channel_rss_url(channel_id: str) -> str:
    """YouTube channel uploads RSS. Pure/testable."""
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"


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


def title_mentions_person(title: str, person: str) -> bool:
    """True if the headline is plausibly ABOUT the person: contains their full
    name or their surname (last name token). Drops Nvidia/industry stories that
    merely mention them in the body. Pure/testable."""
    t = title.lower()
    name = person.lower().strip()
    if name and name in t:
        return True
    surname = name.split()[-1] if name.split() else ""
    return len(surname) >= 3 and surname in t


_STOPWORDS = {
    "the", "a", "an", "to", "of", "at", "in", "on", "for", "and", "or", "is", "are",
    "be", "with", "by", "as", "his", "her", "its", "into", "from", "amid", "over",
}


def _significant_tokens(title: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", title.lower())
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}


def dedupe_stories(items: list[FollowItem]) -> list[FollowItem]:
    """Collapse near-duplicate headlines (the same story across outlets) into a
    single item. Representative preference: primary first, then earliest (closest
    to the original). Similarity = token-set Jaccard >= 0.5 or containment >= 0.8.
    Returns survivors newest-first. Pure/testable."""
    order = sorted(range(len(items)), key=lambda i: (not items[i].primary, items[i].published_ts or 0))
    kept: list[FollowItem] = []
    kept_tokens: list[set[str]] = []
    for idx in order:
        toks = _significant_tokens(items[idx].title)
        is_dup = False
        for kt in kept_tokens:
            if not toks or not kt:
                continue
            inter = len(toks & kt)
            union = len(toks | kt)
            smaller = min(len(toks), len(kt))
            if (union and inter / union >= 0.5) or (smaller and inter / smaller >= 0.8):
                is_dup = True
                break
        if not is_dup:
            kept.append(items[idx])
            kept_tokens.append(toks)
    return sorted(kept, key=lambda i: (i.published_ts is not None, i.published_ts or 0), reverse=True)


def to_follow_items(news: list[NewsItem], person: str, source_label: str) -> list[FollowItem]:
    """Convert canonical NewsItems -> FollowItems, tagging person/kind/source and
    classifying primary vs secondary. Google News items derive their publisher
    from the title suffix (which is stripped from the display title); first-party
    feeds (anything not Google News) are always primary."""
    first_party = source_label != _GOOGLE_NEWS
    items: list[FollowItem] = []
    for n in news:
        if first_party:
            title, publisher, primary, relevant = n.title, source_label, True, True
        else:
            title, publisher = extract_publisher(n.title)
            primary = is_primary_publisher(publisher)
            relevant = title_mentions_person(title, person)
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
                relevant=relevant,
            )
        )
    return items


def merge_dedupe_sort(items: list[FollowItem]) -> list[FollowItem]:
    """Dedupe by URL, sort newest-first (None publishedTs sinks last). Pure."""
    return dedupe_by_url_recent(items)


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

            results = await asyncio.gather(*(one(url, label) for url, label in sources))
            flat = [it for sub in results for it in sub]
            if not flat:
                raise SourceUnavailable(f"No items found for {name}")
            # dedupe exact URLs, then collapse the same story across outlets
            return dedupe_stories(merge_dedupe_sort(flat))

        key = f"people:{name}:{','.join(sorted(feeds))}"
        return await cache.get_or_set(key, _PERSON_TTL, fetch_all)

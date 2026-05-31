"""Shared feed-item helper: dedupe by URL, sort newest-first. Pure/testable.

Both the news (NewsItem) and people (FollowItem) adapters dedupe a flat list of
URL-bearing, optionally-dated items the same way; this is the single source of
that logic. Any item exposing `url: str` and `published_ts: int | None` qualifies.
"""

from __future__ import annotations

from typing import Protocol, TypeVar


class _UrlDated(Protocol):
    url: str
    published_ts: int | None


T = TypeVar("T", bound=_UrlDated)


def dedupe_by_url_recent(items: list[T]) -> list[T]:
    """Dedupe by URL (first occurrence wins), then sort newest-first; items with
    no publishedTs sink to the bottom. Pure."""
    by_url: dict[str, T] = {}
    for it in items:
        if it.url and it.url not in by_url:
            by_url[it.url] = it
    return sorted(
        by_url.values(),
        key=lambda i: (i.published_ts is not None, i.published_ts or 0),
        reverse=True,
    )
